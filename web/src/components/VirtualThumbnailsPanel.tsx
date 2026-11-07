import { useCallback, useSyncExternalStore } from 'react';
import type { VirtualReadingSession } from '../lib/virtualReading';
import { usePdfSession } from '../lib/pdf/react';
import MarkdownMinimap from './MarkdownMinimap';
import PdfThumbnailsPanel from './PdfThumbnailsPanel';
import Icon from './Icon';
import '../styles/virtual-navigation.css';

/** A collection navigator plus the current source's existing, resource-sharing preview. */
export default function VirtualThumbnailsPanel({ reader }: { reader: VirtualReadingSession }) {
  const state = useSyncExternalStore(reader.subscribe, reader.getSnapshot);
  const stream = reader.document.streams.find(stream => stream.id === state.stream)!;
  const source = stream.files.find(file => file.path === state.activeSource);
  const pdf = usePdfSession(source?.kind === 'pdf' ? source.path : null, 'virtual:' + reader.viewId);
  const goToLine = useCallback((line: number) => { if (source) reader.go({ path: source.path, line }); }, [reader, source?.path]);
  const goToPage = useCallback((page: number) => { if (source) reader.go({ path: source.path, page }); }, [reader, source?.path]);
  if (state.configuration) return null;
  return <section className="virtual-thumbnails-panel" aria-label="连续文档缩略图">
    <div className="nav-header"><span className="nav-title">缩略图</span></div>
    <nav className="virtual-thumbnail-sources" aria-label="缩略图文件索引">
      <button type="button" aria-current={!source ? 'location' : undefined} onClick={() => reader.go({ path: reader.document.path })}>
        <Icon name="list" size={14} /><span>目录</span>
      </button>
      {stream.files.map(file => <button key={file.path} type="button" aria-current={file.path === source?.path ? 'location' : undefined}
        onClick={() => reader.go({ path: file.path })}><Icon name={file.kind === 'pdf' ? 'file' : 'file-text'} size={14} /><span>{file.title}</span></button>)}
    </nav>
    <div className="virtual-thumbnail-preview">
      {!source ? <button type="button" className="virtual-cover-thumbnail" aria-label="目录缩略图" onClick={() => reader.go({ path: reader.document.path })}>
        <strong>{reader.document.title}</strong><span>{stream.title}</span>
        <ol>{stream.files.slice(0, 12).map(file => <li key={file.path}>{file.title}</li>)}</ol>
      </button> : source.missing ? <p role="alert" className="panel-empty">来源文件已不存在：{source.path}</p>
        : source.kind === 'markdown' ? <MarkdownMinimap key={source.path} path={source.path} viewId={reader.viewId} transient showHeader={false} onNavigate={goToLine} />
          : pdf ? <PdfThumbnailsPanel session={pdf} onNavigate={goToPage} /> : <p role="status" className="panel-empty">正在加载缩略图…</p>}
    </div>
  </section>;
}
