import { useStore } from '../lib/store';
import FileTree, { collectFolderPaths } from './FileTree';
import SearchPanel from './SearchPanel';
import Icon from './Icon';
import SidebarTabPanels from './SidebarTabPanels';

const TITLES: Record<string, string> = {
  files: 'Files',
  search: 'Search',
};

export default function Sidebar({ open }: { open: boolean }) {
  const leftPanel = useStore((s) => s.leftPanel);
  const activeId = useStore(s => s.leftActiveId);
  const setSettings = useStore(s => s.setSettings);
  const newNote = useStore((s) => s.newNote);
  const newCanvas = useStore((s) => s.newCanvas);
  const newFolder = useStore((s) => s.newFolder);
  const setTrash = useStore((s) => s.setTrash);
  const tree = useStore((s) => s.tree);
  const expanded = useStore((s) => s.expanded);
  const setExpanded = useStore((s) => s.setExpanded);
  const treeSort = useStore((s) => s.treeSort);
  const setTreeSort = useStore((s) => s.setTreeSort);
  const autoReveal = useStore((s) => s.autoReveal);
  const toggleAutoReveal = useStore((s) => s.toggleAutoReveal);
  const openContextMenu = useStore((s) => s.openContextMenu);
  const vaultName = tree?.name || 'Vault';

  const allCollapsed = expanded.length === 0;
  const toggleCollapseAll = () => setExpanded(allCollapsed ? collectFolderPaths(tree) : []);

  const openSortMenu = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    openContextMenu({
      x: r.left,
      y: r.bottom + 4,
      items: [
        { label: 'File name (A to Z)', icon: treeSort === 'name-asc' ? 'check' : undefined, onClick: () => setTreeSort('name-asc') },
        { label: 'File name (Z to A)', icon: treeSort === 'name-desc' ? 'check' : undefined, onClick: () => setTreeSort('name-desc') },
        { label: '', separator: true },
        { label: 'Modified time (new to old)', icon: treeSort === 'mtime-desc' ? 'check' : undefined, onClick: () => setTreeSort('mtime-desc') },
        { label: 'Modified time (old to new)', icon: treeSort === 'mtime-asc' ? 'check' : undefined, onClick: () => setTreeSort('mtime-asc') },
        { label: '', separator: true },
        { label: 'Created time (new to old)', icon: treeSort === 'ctime-desc' ? 'check' : undefined, onClick: () => setTreeSort('ctime-desc') },
        { label: 'Created time (old to new)', icon: treeSort === 'ctime-asc' ? 'check' : undefined, onClick: () => setTreeSort('ctime-asc') },
      ],
    });
  };

  return (
    <div className="sidebar">
      {open && !activeId && <div className="nav-header">
        <span className="nav-title">{TITLES[leftPanel]}</span>
        {leftPanel === 'files' && (
          <>
            <button className="nav-action" title="New note" onClick={() => newNote()}>
              <Icon name="square-pen" size={16} />
            </button>
            <button className="nav-action" title="New canvas" onClick={() => newCanvas()}>
              <Icon name="layout-dashboard" size={16} />
            </button>
            <button className="nav-action" title="New folder" onClick={() => newFolder()}>
              <Icon name="folder-plus" size={16} />
            </button>
            <button className="nav-action" title="Change sort order" onClick={openSortMenu}>
              <Icon name="arrow-up-narrow-wide" size={16} />
            </button>
            <button
              className={`nav-action ${autoReveal ? 'active' : ''}`}
              title="Auto reveal current file"
              onClick={() => toggleAutoReveal()}
            >
              <Icon name="crosshair" size={16} />
            </button>
            <button
              className="nav-action"
              title={allCollapsed ? 'Expand all' : 'Collapse all'}
              onClick={toggleCollapseAll}
            >
              <Icon name={allCollapsed ? 'chevrons-up-down' : 'chevrons-down-up'} size={16} />
            </button>
            <button className="nav-action" title="Trash" onClick={() => setTrash(true)}>
              <Icon name="trash" size={16} />
            </button>
          </>
        )}
      </div>}
      {open && !activeId && <div className="sidebar-body">
        {leftPanel === 'files' && <FileTree />}
        {leftPanel === 'search' && <SearchPanel />}
      </div>}
      <SidebarTabPanels side="left" open={open} />
      <div className="vault-footer">
        <button className="vault-switcher" title="切换仓库" aria-label="切换仓库" aria-haspopup="menu" onClick={event => {
          const rect = event.currentTarget.getBoundingClientRect();
          openContextMenu({ x: rect.left, y: rect.top, items: [
            { label: vaultName, checked: true, onClick: () => {} },
            { label: '', separator: true },
            { label: '切换仓库…', icon: 'folder-open', onClick: () => { setSettings(true); window.dispatchEvent(new Event('vault-settings-open')); } },
          ] });
        }}><Icon name="chevrons-up-down" size={15} /><span>{vaultName}</span></button>
        <button title="Settings" aria-label="设置" onClick={() => setSettings(true)}><Icon name="settings" size={16} /></button>
      </div>
    </div>
  );
}
