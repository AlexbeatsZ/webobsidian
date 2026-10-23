import { useStore, GRAPH_PATH, isHomepagePath } from '../lib/store';
import { api } from '../lib/api';
import { isFolderPath } from '../lib/tree';
import { VIDEO_EXT_RE, AUDIO_EXT_RE } from '../lib/media';
import Editor from './Editor';
import GraphView from './GraphView';
import CanvasView from './CanvasView';
import FolderView from './FolderView';
import Icon from './Icon';
import StatusBar from './StatusBar';
import WorkspaceLauncher from './WorkspaceLauncher';

function EditorPane() {
  const activePath = useStore((s) => s.activePath);
  const isImage = activePath ? /\.(png|jpe?g|gif|svg|webp)$/i.test(activePath) : false;
  const isCanvas = activePath ? /\.canvas$/i.test(activePath) : false;
  const isVideo = activePath ? VIDEO_EXT_RE.test(activePath) : false;
  const isAudio = activePath ? AUDIO_EXT_RE.test(activePath) : false;

  if (activePath && isCanvas) {
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
  return <Editor />;
}

export default function Workspace() {
  const activePath = useStore((s) => s.activePath);
  const splitPath = useStore((s) => s.splitPath);
  const closeSplit = useStore((s) => s.closeSplit);
  const content = useStore((s) => s.content);
  const setContent = useStore((s) => s.setContent);
  const notify = useStore((s) => s.notify);
  const splitDirection = useStore((s) => s.splitDirection);
  const tree = useStore((s) => s.tree);
  const activeIsHome = isHomepagePath(activePath);
  const activeIsFolder = !activeIsHome && isFolderPath(tree, activePath);

  // Paste / drop image → upload to attachments and insert an embed.
  const handleFiles = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;
      try {
        const { path } = await api.upload(file);
        setContent(`${content}\n![[${path}]]\n`);
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
      handleFiles(imgs);
    }
  };
  const onDrop = (e: React.DragEvent) => {
    if (e.dataTransfer.files.length) {
      e.preventDefault();
      handleFiles(e.dataTransfer.files);
    }
  };
  return (
    <div className="workspace" onPaste={onPaste} onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
      <div className={`editor-area ${splitDirection === 'down' ? 'split-down' : ''}`}>
        {(!activePath || activeIsHome) && (
          <div className="empty-state">
            <WorkspaceLauncher key={activePath} />
          </div>
        )}
        {activePath === GRAPH_PATH && (
          <div className="pane main-pane">
            <GraphView />
          </div>
        )}
        {activePath && !activeIsHome && activePath !== GRAPH_PATH && activeIsFolder && (
          <div className="pane main-pane">
            <FolderView path={activePath} />
          </div>
        )}
        {activePath && !activeIsHome && activePath !== GRAPH_PATH && !activeIsFolder && (
          <div className="pane main-pane">
            <EditorPane />
          </div>
        )}
        {splitPath && (
          <div className="pane split-pane">
            <div className="split-head">
              <span className="crumbs">{splitPath}</span>
              <span className="grow" />
              <button className="tool-btn" onClick={closeSplit} title="关闭分屏">
                <Icon name="x" size={16} />
              </button>
            </div>
            <Editor path={splitPath} reading />
          </div>
        )}
      </div>
      <StatusBar />
    </div>
  );
}
