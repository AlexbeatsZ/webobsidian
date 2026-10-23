import { useStore, type ContextMenuItem } from '../lib/store';
import { pathToUrl } from '../lib/urlsync';
import Icon from './Icon';

export default function BookmarksPanel() {
  const bookmarks = useStore((s) => s.bookmarks);
  const recent = useStore((s) => s.recent);
  const openFile = useStore((s) => s.openFile);
  const openToSide = useStore((s) => s.openToSide);
  const toggleBookmark = useStore((s) => s.toggleBookmark);
  const removeRecent = useStore((s) => s.removeRecent);
  const revealInTree = useStore((s) => s.revealInTree);
  const setMovePath = useStore((s) => s.setMovePath);
  const openContextMenu = useStore((s) => s.openContextMenu);
  const notify = useStore((s) => s.notify);

  const name = (p: string) => p.split('/').pop()?.replace(/\.(md|markdown)$/, '') ?? p;

  const copyUrl = (p: string) => {
    navigator.clipboard?.writeText(`${location.origin}${pathToUrl(p)}`).catch(() => {});
    notify("URL 已复制");
  };

  // Drag a row onto a folder in the file tree to move the underlying file
  // (FileTree's onDrop reads this same `text/wo-path` payload).
  const onDragStart = (e: React.DragEvent, path: string) => {
    e.dataTransfer.setData('text/wo-path', path);
    e.dataTransfer.effectAllowed = 'move';
  };

  const showMenu = (e: React.MouseEvent, path: string, kind: 'bookmark' | 'recent') => {
    e.preventDefault();
    e.stopPropagation();
    const isBookmarked = bookmarks.includes(path);
    const items: ContextMenuItem[] = [
      { label: "打开", icon: 'file-text', onClick: () => openFile(path) },
      { label: "在右侧打开", icon: 'columns', onClick: () => openToSide(path) },
      { label: '', separator: true },
      { label: "在文件列表中显示", icon: 'folder', onClick: () => revealInTree(path) },
      { label: "移动文件至…", icon: 'folder', onClick: () => setMovePath(path) },
      { label: isBookmarked ? "移除书签" : "添加书签", icon: 'bookmark', onClick: () => toggleBookmark(path) },
      ...(kind === 'recent'
        ? [{ label: "从最近列表中移除", icon: 'x', onClick: () => removeRecent(path) } as ContextMenuItem]
        : []),
      { label: "复制 URL 路径", onClick: () => copyUrl(path) },
    ];
    openContextMenu({ x: e.clientX, y: e.clientY, items });
  };

  const actionBtn = (e: React.MouseEvent, fn: () => void) => {
    e.stopPropagation();
    fn();
  };

  return (
    <div>
      <div className="panel-title">书签</div>
      {bookmarks.length === 0 && <div className="panel-item">暂无书签</div>}
      {bookmarks.map((b) => (
        <div
          key={b}
          className="panel-item"
          draggable
          onDragStart={(e) => onDragStart(e, b)}
          onClick={() => openFile(b)}
          onContextMenu={(e) => showMenu(e, b, 'bookmark')}
          title={b}
        >
          <Icon name="bookmark" size={14} /> <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name(b)}</span>
          <span className="panel-item-actions">
            <span title="移动文件至…" onClick={(e) => actionBtn(e, () => setMovePath(b))}>
              <Icon name="folder" size={13} />
            </span>
            <span title="移除书签" onClick={(e) => actionBtn(e, () => toggleBookmark(b))}>
              <Icon name="x" size={13} />
            </span>
          </span>
        </div>
      ))}
      <div className="panel-title" style={{ marginTop: 8 }}>最近</div>
      {recent.length === 0 && <div className="panel-item">暂无最近文件</div>}
      {recent.map((r) => (
        <div
          key={r}
          className="panel-item"
          draggable
          onDragStart={(e) => onDragStart(e, r)}
          onClick={() => openFile(r)}
          onContextMenu={(e) => showMenu(e, r, 'recent')}
          title={r}
        >
          <Icon name="clock" size={14} /> <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name(r)}</span>
          <span className="panel-item-actions">
            <span title="移动文件至…" onClick={(e) => actionBtn(e, () => setMovePath(r))}>
              <Icon name="folder" size={13} />
            </span>
            <span title="从最近列表中移除" onClick={(e) => actionBtn(e, () => removeRecent(r))}>
              <Icon name="x" size={13} />
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}
