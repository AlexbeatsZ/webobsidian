import { useEffect, useRef, useState } from 'react';
import { useStore, GRAPH_PATH, isHomepagePath } from '../lib/store';
import { api } from '../lib/api';
import { documents } from '../lib/documents';
import { activateNavigation } from '../lib/activeEditor';
import { isFolderPath } from '../lib/tree';
import { VIDEO_EXT_RE, AUDIO_EXT_RE } from '../lib/media';
import { TAB_DRAG_TYPE, tabDrag } from '../lib/tabDrag';
import Editor from './Editor';
import GraphView from './GraphView';
import FolderView from './FolderView';
import Icon from './Icon';
import StatusBar from './StatusBar';
import WorkspaceLauncher from './WorkspaceLauncher';
import VirtualDocumentView from './VirtualDocumentView';
import { findNode } from '../lib/tree';

function EditorPane({ path: activePath, navigationId }: { path: string; navigationId: 'main' | 'split' }) {
  const collection = useStore(state => findNode(state.tree, activePath)?.virtualDocument);
  if (collection) return <VirtualDocumentView document={collection} viewId={navigationId} />;
  if (isHomepagePath(activePath)) return <div className="empty-state"><WorkspaceLauncher key={activePath} /></div>;
  const isImage = activePath ? /\.(png|jpe?g|gif|svg|webp)$/i.test(activePath) : false;
  const isVideo = activePath ? VIDEO_EXT_RE.test(activePath) : false;
  const isAudio = activePath ? AUDIO_EXT_RE.test(activePath) : false;

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
  const close = useStore((state) => state.closePane);
  return <div className={`pane ${navigationId}-pane`} data-view-id={navigationId}
    onPointerDownCapture={() => activateNavigation(navigationId)} onFocusCapture={() => activateNavigation(navigationId)}>
    <button className="tool-btn pane-close" onClick={() => void close(navigationId)} title={navigationId === 'main' ? '关闭标签页' : '关闭分屏'}>
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
  const activeIsFolder = !activeIsHome && isFolderPath(tree, activePath) && !findNode(tree, activePath ?? '')?.virtualDocument;
  const workspace = useRef<HTMLDivElement>(null);
  const [drop, setDrop] = useState<{ view: 'main' | 'split' | 'right' | 'down'; left: number; top: number; width: number; height: number } | null>(null);

  useEffect(() => {
    const clear = () => setDrop(null);
    window.addEventListener('dragend', clear);
    return () => window.removeEventListener('dragend', clear);
  }, []);

  // A dragged tab replaces the pane under the pointer; without a split, the far
  // half of the editor opens it side by side (right) or below (down).
  const dropTarget = (e: React.DragEvent) => {
    const host = workspace.current, area = host?.querySelector<HTMLElement>(':scope > .editor-area'), path = tabDrag.path;
    if (!host || !area || !path) return null;
    const origin = host.getBoundingClientRect(), box = area.getBoundingClientRect();
    const sideable = isHomepagePath(path) || (path !== GRAPH_PATH && !isFolderPath(tree, path));
    const at = (view: 'main' | 'split' | 'right' | 'down', r: { left: number; top: number; width: number; height: number }) =>
      ({ view, left: r.left - origin.left, top: r.top - origin.top, width: r.width, height: r.height });
    if (splitPath) {
      const pane = (e.target as Element).closest<HTMLElement>('[data-view-id]');
      const view = pane?.dataset.viewId === 'split' && sideable ? 'split' : 'main';
      const element = area.querySelector<HTMLElement>(`:scope > [data-view-id="${view}"]`);
      return element ? at(view, element.getBoundingClientRect()) : null;
    }
    const x = (e.clientX - box.left) / box.width, y = (e.clientY - box.top) / box.height;
    if (sideable && x > 0.5 && x >= y) return at('right', { left: box.left + box.width / 2, top: box.top, width: box.width / 2, height: box.height });
    if (sideable && y > 0.5) return at('down', { left: box.left, top: box.top + box.height / 2, width: box.width, height: box.height / 2 });
    return at('main', box);
  };
  const onTabDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(TAB_DRAG_TYPE)) return;
    // Capture before CodeMirror so a tab never drops as text into the note.
    e.preventDefault(); e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    const next = dropTarget(e);
    setDrop(prev => prev && next && (Object.keys(next) as (keyof typeof next)[]).every(key => prev[key] === next[key]) ? prev : next);
  };
  const onTabDrop = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(TAB_DRAG_TYPE)) return;
    e.preventDefault(); e.stopPropagation();
    const target = dropTarget(e), path = tabDrag.path;
    setDrop(null);
    if (!target || !path) return;
    const s = useStore.getState();
    if (target.view === 'right' || target.view === 'down') void s.openToSide(path, target.view);
    else if (s.splitPath) void s.replacePane(target.view, path);
    else if ((target.view === 'split' ? s.splitPath : s.activePath) !== path) void s.openFile(path, true, target.view);
  };

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
    // Chromium names raw clipboard bitmaps image.png; name those like Obsidian's pasted
    // images. Copied files keep their own names (the server still avoids replacement).
    const imgs = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/')).map((f) => {
      if (f.name !== 'image.png') return f;
      const stamp = new Date(), pad = (n: number) => String(n).padStart(2, '0');
      const time = `${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}`;
      return new File([f], `Pasted image ${time}.png`, { type: f.type });
    });
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
    <div className="workspace" ref={workspace} onPaste={onPaste} onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
      <div className={`editor-area ${splitDirection === 'down' ? 'split-down' : ''}`}
        onDragOverCapture={onTabDragOver} onDropCapture={onTabDrop}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null); }}>
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
      {drop && <div className="pane-drop-indicator" style={{ left: drop.left, top: drop.top, width: drop.width, height: drop.height }} />}
      <StatusBar />
    </div>
  );
}
