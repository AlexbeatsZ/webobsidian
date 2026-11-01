import { useStore, GRAPH_PATH, isHomepagePath } from '../lib/store';
import { api } from '../lib/api';
import { documents } from '../lib/documents';
import { activateNavigation } from '../lib/activeEditor';
import { isFolderPath } from '../lib/tree';
import { VIDEO_EXT_RE, AUDIO_EXT_RE } from '../lib/media';
import Editor from './Editor';
import GraphView from './GraphView';
import CanvasView from './CanvasView';
import FolderView from './FolderView';
import Icon from './Icon';
import StatusBar from './StatusBar';
import WorkspaceLauncher from './WorkspaceLauncher';

function EditorPane({ path: activePath, navigationId }: { path: string; navigationId: 'main' | 'split' }) {
  if (isHomepagePath(activePath)) return <div className="empty-state"><WorkspaceLauncher key={activePath} /></div>;
  const isImage = activePath ? /\.(png|jpe?g|gif|svg|webp)$/i.test(activePath) : false;
  const isCanvas = activePath ? /\.canvas$/i.test(activePath) : false;
  const isVideo = activePath ? VIDEO_EXT_RE.test(activePath) : false;
  const isAudio = activePath ? AUDIO_EXT_RE.test(activePath) : false;

  if (isCanvas && navigationId === 'main') {
    return <CanvasView />;
  }
  if (activePath && isImage) {
    return (
      <div className="markdown-preview">
        <div className="preview-inner">
          <img src={api.rawUrl(activePath)} alt={activePath} />
        </div>
      </div>
    );
  }
  if (activePath && (isVideo || isAudio)) {
    return (
      <div className="markdown-preview">
        <div className="preview-inner">
          {isVideo ? (
            <video
              className="media-embed media-fileview"
              src={api.rawUrl(activePath)}
              controls
              preload="metadata"
            />
          ) : (
            <audio
              className="media-embed media-fileview"
              src={api.rawUrl(activePath)}
              controls
              preload="metadata"
            />
          )}
        </div>
      </div>
    );
  }
  // Reading mode = the same Live Preview editor in read-only (identical render).
  return <Editor path={activePath} navigationId={navigationId} />;
}

function WorkspacePane({ path, navigationId }: { path: string; navigationId: 'main' | 'split' }) {
  const close = useStore((state) => navigationId === 'main' ? state.closeTab : state.closeSplit);
  return <div className={`pane ${navigationId}-pane`} data-view-id={navigationId}
    onPointerDownCapture={() => activateNavigation(navigationId)} onFocusCapture={() => activateNavigation(navigationId)}>
    <button className="tool-btn pane-close" onClick={() => void close(path)} title={navigationId === 'main' ? '关闭标签页' : '关闭分屏'}>
      <Icon name="x" size={16} />
    </button>
    <EditorPane path={path} navigationId={navigationId} />
  </div>;
}

export default function Workspace() {
  const activePath = useStore((s) => s.activePath);
  const splitPath = useStore((s) => s.splitPath);

  const notify = useStore((s) => s.notify);
  const splitDirection = useStore((s) => s.splitDirection);
  const tree = useStore((s) => s.tree);
  const activeIsHome = isHomepagePath(activePath);
  const activeIsFolder = !activeIsHome && isFolderPath(tree, activePath);

  // Paste / drop image → upload to attachments and insert an embed.
  const handleFiles = async (files: FileList | File[], sourcePath: string) => {
    const session = documents.get(sourcePath);
    if (!session || session.snapshot.locked) return;
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;
      try {
        const { path } = await api.upload(file, undefined, sourcePath);
        if (documents.get(session.id) !== session) throw new Error(`笔记已关闭，附件已保存到 ${path}`);
        session.setRawText(`${session.snapshot.raw}\n![[${path}]]\n`);
        notify(`已插入 ${path}`);
      } catch (e: any) {
        notify(e.message);
      }
    }
  };
  const onPaste = (e: React.ClipboardEvent) => {
    const imgs = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'));
    if (imgs.length) {
      e.preventDefault();
      void handleFiles(imgs, (e.target as Element).closest<HTMLElement>('[data-document-id]')?.dataset.documentId ?? activePath ?? '');
    }
  };
  const onDrop = (e: React.DragEvent) => {
    if (e.dataTransfer.files.length) {
      e.preventDefault();
      if ((e.target as Element).closest('[data-mode="reading"]')) return;
      void handleFiles(e.dataTransfer.files, (e.target as Element).closest<HTMLElement>('[data-document-id]')?.dataset.documentId ?? activePath ?? '');
    }
  };
  return (
    <div className="workspace" onPaste={onPaste} onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
      <div className={`editor-area ${splitDirection === 'down' ? 'split-down' : ''}`}>
        {(!activePath || activeIsHome) && (
          <div className="empty-state" data-view-id="main" onPointerDownCapture={() => activateNavigation('main')} onFocusCapture={() => activateNavigation('main')}>
            <WorkspaceLauncher key={activePath} />
          </div>
        )}
        {activePath === GRAPH_PATH && (
          <div className="pane main-pane" data-view-id="main" onPointerDownCapture={() => activateNavigation('main')} onFocusCapture={() => activateNavigation('main')}>
            <GraphView />
          </div>
        )}
        {activePath && !activeIsHome && activePath !== GRAPH_PATH && activeIsFolder && (
          <div className="pane main-pane" data-view-id="main" onPointerDownCapture={() => activateNavigation('main')} onFocusCapture={() => activateNavigation('main')}>
            <FolderView path={activePath} />
          </div>
        )}
        {activePath && !activeIsHome && activePath !== GRAPH_PATH && !activeIsFolder && (
          <WorkspacePane path={activePath} navigationId="main" />
        )}
        {splitPath && <WorkspacePane path={splitPath} navigationId="split" />}
      </div>
      <StatusBar />
    </div>
  );
}
