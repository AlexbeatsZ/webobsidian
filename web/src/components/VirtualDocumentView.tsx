import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { DocumentSession, fragmentRange } from '@webobsidian/markdown-core';
import { EditorView } from '@codemirror/view';
import { api } from '../lib/api';
import { documents } from '../lib/documents';
import { useStore } from '../lib/store';
import { createVaultRenderContext } from '../lib/vaultRenderContext';
import { readingWindow, type VirtualDocument, type VirtualSource } from '../lib/virtualDocuments';
import { VirtualReadingSession, registerVirtualReading, type ReadingTarget } from '../lib/virtualReading';
import { PdfSession } from '../lib/pdf/session';
import { usePdfSnapshot } from '../lib/pdf/react';
import { PageSlot } from './PdfViewer';
import MarkdownView from './MarkdownView';
import FolderView from './FolderView';
import Icon from './Icon';
import '../styles/virtual-document.css';

const noSubscribe = () => () => {};
function MarkdownChapter({ source, target, viewId, layoutVersion }: { source: VirtualSource; target?: ReadingTarget; viewId: string; layoutVersion: number }) {
  const existing = documents.get(source.path);
  const snapshot = useSyncExternalStore(existing?.subscribe ?? noSubscribe, () => existing?.snapshot ?? null);
  const [loaded, setLoaded] = useState<DocumentSession>();
  const [error, setError] = useState('');
  const fileChange = useStore(state => state.lastFileChange);
  const refresh = fileChange?.path === source.path ? fileChange.stat.mtime : 0;
  useEffect(() => {
    if (existing) return;
    const abort = new AbortController();
    void api.read(source.path, undefined, abort.signal).then(file => {
      if (!abort.signal.aborted) setLoaded(new DocumentSession(source.path, file.content, file.revision,
        async () => { throw new Error('连续阅读请打开源文件编辑'); }));
    }, cause => { if (!abort.signal.aborted) setError(String(cause)); });
    return () => { abort.abort(); };
  }, [source.path, existing, refresh]);
  const session = existing ?? loaded;
  const current = snapshot ?? session?.snapshot;
  const editor = useRef<EditorView | null>(null);
  const context = useMemo(() => ({ ...createVaultRenderContext(source.path, {
    files: () => useStore.getState().filePaths, openMenu: menu => useStore.getState().openContextMenu(menu),
    reportError: message => useStore.getState().notify(message),
    openLink: (link, path, intent) => { void useStore.getState().openWikilink(link, path, intent); },
  }), navigationId: 'virtual:' + viewId + ':' + source.path }), [source.path, viewId]);
  const seek = () => {
    if (!target?.fragment || !session || !editor.current) return;
    const range = fragmentRange(session.analysis, target.fragment);
    if (range) editor.current.dispatch({ selection: { anchor: range.from }, effects: EditorView.scrollIntoView(range.from, { y: 'start' }) });
  };
  useEffect(seek, [target, session, current?.version, layoutVersion]);
  if (error) return <p role="alert">{error}</p>;
  if (!session || !current) return <p role="status">正在载入章节…</p>;
  return <MarkdownView snapshot={current} analysis={session.analysis} mode="reading" layout="embedded" showTitle={false} context={context}
    onReady={view => { editor.current = view; requestAnimationFrame(seek); }} />;
}

function PdfChapter({ source, reader, root, width, target, layoutVersion }: { source: VirtualSource; reader: VirtualReadingSession;
  root: RefObject<HTMLDivElement>; width: number; target?: ReadingTarget; layoutVersion: number }) {
  const session = useMemo(() => new PdfSession(source.path, 'virtual:' + reader.viewId), [source.path, reader.viewId]);
  const state = usePdfSnapshot(session);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => () => session.destroy(), [session]);
  useEffect(() => { if (state.status === 'ready') reader.outline(source.path, state.outline); }, [reader, source.path, state.status, state.outline]);
  useEffect(() => {
    if (state.status !== 'ready' || !target?.page) return;
    const frame = requestAnimationFrame(() => {
      host.current?.querySelector<HTMLElement>(`[data-page-number="${target.page}"]`)?.scrollIntoView({ block: 'start' });
      session.observePage(target.page!);
    });
    return () => cancelAnimationFrame(frame);
  }, [target, state.status, session, layoutVersion]);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    let frame = 0;
    const observe = () => {
      cancelAnimationFrame(frame); frame = requestAnimationFrame(() => {
        const slots = host.current?.querySelectorAll<HTMLElement>('[data-page-number]');
        if (!slots?.length) return;
        const bounds = host.current!.getBoundingClientRect(), viewport = element.getBoundingClientRect();
        if (bounds.bottom < viewport.top || bounds.top > viewport.bottom) return;
        const top = element.getBoundingClientRect().top + 32;
        let low = 0, high = slots.length - 1;
        while (low < high) { const middle = Math.ceil((low + high) / 2); if (slots[middle].getBoundingClientRect().top <= top) low = middle; else high = middle - 1; }
        session.observePage(Number(slots[low].dataset.pageNumber));
      });
    };
    element.addEventListener('scroll', observe, { passive: true });
    return () => { element.removeEventListener('scroll', observe); cancelAnimationFrame(frame); };
  }, [root, session, state.pageCount]);
  if (state.status === 'error') return <p role="alert">{state.error}</p>;
  return <div ref={host} className="virtual-pdf-pages">
    {state.status !== 'ready' ? <p role="status">正在打开 PDF…</p> : Array.from({ length: state.pageCount }, (_, index) =>
      <PageSlot key={index} page={index + 1} session={session} width={width} root={root} anchorWithin={host} />)}
  </div>;
}

function SourceSlot({ source, mounted, estimate, onMeasure, reader, root, width, target, layoutVersion }: {
  source: VirtualSource; mounted: boolean; estimate: number; onMeasure: (height: number) => void;
  reader: VirtualReadingSession; root: RefObject<HTMLDivElement>; width: number; target?: ReadingTarget; layoutVersion: number;
}) {
  const body = useRef<HTMLDivElement>(null), measure = useRef(onMeasure); measure.current = onMeasure;
  useLayoutEffect(() => {
    if (!mounted || !body.current) return;
    const observer = new ResizeObserver(entries => {
      if (body.current?.querySelector('[role="status"]')) return;
      const height = Math.ceil(entries[0].borderBoxSize?.[0]?.blockSize ?? body.current!.getBoundingClientRect().height);
      if (height > 0) measure.current(height);
    });
    observer.observe(body.current); return () => observer.disconnect();
  }, [mounted]);
  return <section className="virtual-source" data-virtual-source={source.path} data-mounted={mounted} style={mounted ? { minHeight: estimate } : { height: estimate }}>
    {mounted && <div ref={body} className="virtual-source-body">
      <header className="virtual-source-header"><h2>{source.title}</h2><button className="tool-btn" aria-label={'打开源文件 ' + source.title}
        onClick={() => void useStore.getState().openFile(source.path, true, reader.viewId)} title={source.kind === 'markdown' ? '打开源文件编辑' : '单独打开 PDF'}><Icon name="external-link" size={16} /></button></header>
      {source.missing ? <p role="alert">来源文件已不存在：{source.path}</p> : source.kind === 'markdown'
        ? <MarkdownChapter source={source} target={target} viewId={reader.viewId} layoutVersion={layoutVersion} />
        : <PdfChapter source={source} reader={reader} root={root} width={width} target={target} layoutVersion={layoutVersion} />}
    </div>}
  </section>;
}

function ContinuousReader({ reader }: { reader: VirtualReadingSession }) {
  const state = useSyncExternalStore(reader.subscribe, reader.getSnapshot);
  const stream = reader.document.streams.find(stream => stream.id === state.stream)!;
  const root = useRef<HTMLDivElement>(null), cover = useRef<HTMLElement>(null);
  const progress = reader.progress();
  const [heights, setHeights] = useState(() => progress?.stream === stream.id && progress.heights.length === stream.files.length ? progress.heights : stream.files.map(file => file.kind === 'pdf' ? 1400 : Math.max(800, Math.min(16000, file.size / 2))));
  const heightRef = useRef(heights); heightRef.current = heights;
  const layoutVersion = useRef(0);
  const [window, setWindow] = useState({ first: 0, last: 1 });
  const [width, setWidth] = useState(760);
  const stale = useStore(state => state.vaultSessionStale);
  const navigating = useRef(false);
  const navigationIndex = useRef<number | null>(null);
  const anchor = useRef<{ index: number; offset: number } | null>(null);
  const correcting = useRef(false), correctionFrame = useRef(0), releaseFrame = useRef(0);
  const captureAnchor = () => {
    const element = root.current;
    if (!element || element.scrollTop < (cover.current?.offsetHeight ?? 0)) { anchor.current = null; return; }
    const top = element.getBoundingClientRect().top;
    const slots = element.querySelectorAll<HTMLElement>('[data-virtual-source]');
    let low = 0, high = slots.length - 1;
    while (low < high) { const middle = Math.floor((low + high) / 2); if (slots[middle].getBoundingClientRect().bottom <= top) low = middle + 1; else high = middle; }
    // A preceding chapter may grow before its ResizeObserver runs. A scroll
    // event from that layout must not replace the requested chapter with its
    // neighbour. Real user scrolling releases this navigation constraint.
    if (navigationIndex.current !== null && low !== navigationIndex.current) return;
    if (slots[low]) anchor.current = { index: low, offset: top - slots[low].getBoundingClientRect().top };
  };
  const updateWindow = () => {
    const element = root.current;
    if (!element || correcting.current) return;
    setWindow(readingWindow(heightRef.current, Math.max(0, element.scrollTop - (cover.current?.offsetHeight ?? 0)), element.clientHeight));
  };
  const restoreAnchor = () => {
    correcting.current = true;
    cancelAnimationFrame(correctionFrame.current); cancelAnimationFrame(releaseFrame.current);
    correctionFrame.current = requestAnimationFrame(() => {
      const element = root.current, current = anchor.current;
      const slot = element?.querySelectorAll<HTMLElement>('[data-virtual-source]')[current?.index ?? -1];
      if (element && current && slot) element.scrollTop += slot.getBoundingClientRect().top - element.getBoundingClientRect().top + current.offset;
      releaseFrame.current = requestAnimationFrame(() => { correcting.current = false; updateWindow(); });
    });
  };
  useEffect(() => registerVirtualReading(reader), [reader]);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    if (progress?.stream === stream.id) element.scrollTop = progress.top;
    captureAnchor();
    updateWindow();
    const observer = new ResizeObserver(entries => { setWidth(Math.max(180, Math.min(900, entries[0].contentRect.width - 48))); updateWindow(); });
    observer.observe(element);
    let frame = 0;
    const scroll = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { if (!correcting.current && !navigating.current) captureAnchor(); updateWindow(); }); };
    const userScroll = () => { navigationIndex.current = null; reader.releaseTarget(); };
    element.addEventListener('scroll', scroll, { passive: true });
    for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) element.addEventListener(event, userScroll, { passive: true });
    return () => { reader.remember(stream.id, element.scrollTop, heightRef.current); observer.disconnect(); element.removeEventListener('scroll', scroll); for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) element.removeEventListener(event, userScroll); cancelAnimationFrame(frame); cancelAnimationFrame(correctionFrame.current); cancelAnimationFrame(releaseFrame.current); };
  }, [reader]);
  useLayoutEffect(() => {
    if (!state.target || !root.current) return;
    const index = stream.files.findIndex(file => file.path === state.target!.path);
    if (index < 0) return;
    navigating.current = true;
    navigationIndex.current = index;
    anchor.current = { index, offset: 0 };
    setWindow({ first: Math.max(0, index - 1), last: Math.min(stream.files.length - 1, index + 1) });
    const frame = requestAnimationFrame(() => {
      const slot = root.current?.querySelectorAll<HTMLElement>('[data-virtual-source]')[index];
      if (slot && root.current) root.current.scrollTop += slot.getBoundingClientRect().top - root.current.getBoundingClientRect().top;
      navigating.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [state.serial]);
  const measured = (index: number, height: number) => {
    const old = heightRef.current[index];
    if (Math.abs(old - height) < 2) return;
    layoutVersion.current++;
    const next = [...heightRef.current]; next[index] = height; heightRef.current = next; setHeights(next);
    if (anchor.current && index < anchor.current.index) restoreAnchor();
    else updateWindow();
  };
  if (stale) return <p role="alert">Vault 已切换，请重新加载；源文件草稿保留。</p>;
  return <div ref={root} className="virtual-document-scroll" tabIndex={0} aria-label="连续文档阅读">
    <article ref={cover} className="virtual-document-cover">
      <div className="virtual-cover-label">{reader.document.title}</div><h1>{stream.title}</h1>
      <nav aria-label="文档索引"><ol>{stream.files.map(source => <li key={source.path}><button onClick={() => reader.go({ path: source.path })}>{source.title}</button></li>)}</ol></nav>
    </article>
    {stream.files.map((source, index) => <SourceSlot key={source.path} source={source} mounted={index >= window.first && index <= window.last}
      estimate={heights[index]} onMeasure={height => measured(index, height)} reader={reader} root={root} width={width}
      layoutVersion={layoutVersion.current}
      target={state.target?.path === source.path ? state.target : undefined} />)}
  </div>;
}

export default function VirtualDocumentView({ document, viewId = 'main' }: { document: VirtualDocument; viewId?: string }) {
  const metadataIdentity = JSON.stringify(document);
  const reader = useMemo(() => new VirtualReadingSession(document, viewId), [metadataIdentity, viewId]);
  const snapshot = useSyncExternalStore(reader.subscribe, reader.getSnapshot);
  const [sources, setSources] = useState(false);
  return <section className="virtual-document-view" data-virtual-document={document.path}>
    <header className="virtual-document-toolbar"><Icon name="book-open" size={17} /><span>{document.title}</span>
      <div className="virtual-streams" role="tablist" aria-label="阅读分组">{document.streams.map(stream => <button key={stream.id} role="tab" aria-selected={snapshot.stream === stream.id}
        onClick={() => { setSources(false); reader.selectStream(stream.id); }}>{stream.title}</button>)}</div>
      <button className="tool-btn" title={sources ? '返回连续阅读' : '查看源文件'} aria-label="查看源文件" aria-pressed={sources} onClick={() => setSources(value => !value)}><Icon name={sources ? 'book-open' : 'folder'} size={17} /></button>
      <button className="tool-btn" title="配置连续文档" aria-label="配置连续文档" onClick={() => void useStore.getState().openFile(document.path + '/.virtual-document.json', true, viewId)}><Icon name="settings" size={17} /></button>
    </header>
    {sources ? <FolderView path={document.path} /> : <ContinuousReader key={snapshot.stream} reader={reader} />}
  </section>;
}
