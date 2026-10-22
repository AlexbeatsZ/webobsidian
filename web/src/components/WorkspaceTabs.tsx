import { useEffect, useRef } from 'react';
import { useStore, GRAPH_PATH, type ContextMenuItem } from '../lib/store';
import { api } from '../lib/api';
import { documents } from '../lib/documents';
import { printDocument } from '../lib/printDocument';
import { createVaultRenderContext } from '../lib/vaultRenderContext';
import { editorFind, getActiveEditor } from '../lib/activeEditor';
import { triggerAddProperty } from '../lib/livePreview';
import { pathToUrl } from '../lib/urlsync';
import { useIsMobile } from '../lib/useIsMobile';
import Icon from './Icon';

export default function WorkspaceTabs() {
  const tabs = useStore((s) => s.tabs);
  const activePath = useStore((s) => s.activePath);
  const openFile = useStore((s) => s.openFile);
  const closeTab = useStore((s) => s.closeTab);
  const dirty = useStore((s) => s.dirty);
  const setViewMode = useStore((s) => s.setViewMode);
  const bookmarks = useStore((s) => s.bookmarks);
  const toggleBookmark = useStore((s) => s.toggleBookmark);
  const openToSide = useStore((s) => s.openToSide);
  const notify = useStore((s) => s.notify);
  const toggleLeft = useStore((s) => s.toggleLeft);
  const toggleRight = useStore((s) => s.toggleRight);
  const leftOpen = useStore((s) => s.leftOpen);
  const rightOpen = useStore((s) => s.rightOpen);
  const mobileDrawer = useStore((s) => s.mobileDrawer);
  const setMobileDrawer = useStore((s) => s.setMobileDrawer);
  const newNote = useStore((s) => s.newNote);
  const openContextMenu = useStore((s) => s.openContextMenu);
  const setMovePath = useStore((s) => s.setMovePath);
  const setRightPanel = useStore((s) => s.setRightPanel);
  const setShareDialog = useStore((s) => s.setShareDialog);
  const setVersionHistory = useStore((s) => s.setVersionHistory);
  const revealInTree = useStore((s) => s.revealInTree);
  const loadTree = useStore((s) => s.loadTree);
  const isMobile = useIsMobile();
  const scroll = useRef<HTMLDivElement>(null);

  const inTab = async (path: string, action: () => void) => {
    if (useStore.getState().activePath !== path) await openFile(path);
    // Let the requested editor/graph mount before invoking its view command.
    window.requestAnimationFrame(() => {
      if (useStore.getState().activePath === path) action();
    });
  };

  useEffect(() => {
    scroll.current?.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activePath, tabs.length]);

  // Obsidian's "Add file property": focus a new property-key field in the
  // Properties widget with the key suggester open (NOT a text prompt). The
  // widget only renders in Live Preview, so switch out of source/reading first.
  const addFileProperty = async (path: string) => {
    await openFile(path);
    if (useStore.getState().viewMode !== 'live') setViewMode('live');
    // Let the editor swap modes / mount the Properties widget, then start the add.
    window.setTimeout(() => {
      const v = getActiveEditor();
      if (v) triggerAddProperty(v);
      else notify('Open the note to add a property');
    }, 80);
  };

  const exportToPdf = async (path: string) => {
    await openFile(path);
    const snapshot = documents.get(path)?.snapshot; if (!snapshot) return;
    const context = createVaultRenderContext(path, { openLink: () => {}, openMenu: () => {}, files: () => [], reportError: notify });
    void printDocument(snapshot, context).catch(error => notify(error.message));
  };

  // File actions now live on the tab context menu instead of a second header.
  const openTabMenu = (e: React.MouseEvent, path: string) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const isMd = /\.(md|markdown)$/i.test(path);
    const isShareable = /\.(md|markdown|canvas)$/i.test(path);
    const canSplit = /\.(md|markdown|txt|json|csv|canvas|css|js|ya?ml)$/i.test(path);
    const baseName = path.split('/').pop() ?? path;
    const closeOthers = () => tabs.filter((t) => t.path !== path).forEach((t) => closeTab(t.path));
    const tabItems: ContextMenuItem[] = [
      { label: 'Close tab', icon: 'x', onClick: () => closeTab(path) },
      { label: 'Close other tabs', onClick: closeOthers },
    ];
    let items: ContextMenuItem[];
    if (path === GRAPH_PATH) {
      items = [
        // GraphView owns the Pixi renderer — it listens for this event and
        // extracts the stage to a PNG (a plain canvas read would be blank).
        { label: 'Copy screenshot', icon: 'camera', onClick: () => void inTab(path, () => window.dispatchEvent(new CustomEvent('wo-graph-screenshot'))) },
        { label: '', separator: true },
        ...tabItems,
      ];
    } else {
      const sep: ContextMenuItem = { label: '', separator: true };
      const renameItem: ContextMenuItem = {
        label: 'Rename…',
        icon: 'pencil',
        onClick: async () => {
          const to = prompt('Rename / move to (vault-relative path):', path);
          if (to && to !== path) {
            await api.rename(path, to);
            closeTab(path);
            await loadTree();
            await openFile(to);
          }
        },
      };
      const moveItem: ContextMenuItem = {
        label: 'Move file to…',
        icon: 'folder',
        onClick: () => setMovePath(path),
      };
      const copyItem: ContextMenuItem = {
        label: 'Make a copy',
        icon: 'file-plus',
        onClick: async () => {
          const r = await api.read(path).catch(() => null);
          if (!r) return;
          const body = typeof r === 'string' ? r : r.content;
          const dot = path.lastIndexOf('.');
          const copyPath = dot > 0 ? `${path.slice(0, dot)} copy${path.slice(dot)}` : `${path} copy`;
          await api.write(copyPath, body);
          await loadTree();
          notify('Made a copy');
        },
      };
      items = [
        ...(isMd ? [{ label: 'Backlinks in document', icon: 'link', onClick: () => void inTab(path, () => setRightPanel('backlinks')) }, sep] : []),
        ...(canSplit
          ? [
              { label: 'Split right', icon: 'columns', onClick: () => openToSide(path, 'right') },
              { label: 'Split down', icon: 'rows', onClick: () => openToSide(path, 'down') },
            ]
          : []),
        { label: 'Open in new window', icon: 'arrow-up-right', onClick: () => window.open(pathToUrl(path), '_blank', 'noopener') },
        sep,
        renameItem,
        moveItem,
        copyItem,
        { label: bookmarks.includes(path) ? 'Remove bookmark' : 'Bookmark', icon: 'bookmark', onClick: () => toggleBookmark(path) },
        ...(isMd ? [{ label: 'Add file property', icon: 'plus', onClick: () => void addFileProperty(path) }] : []),
        ...(isMd ? [{ label: 'Export to PDF…', icon: 'file-pdf', onClick: () => void exportToPdf(path) }] : []),
        ...(canSplit
          ? [
              sep,
              {
                label: 'Find…',
                icon: 'search',
                onClick: () => void inTab(path, () => {
                  if (!editorFind()) notify('Open the note to search inside it');
                }),
              },
            ]
          : []),
        sep,
        {
          label: 'Copy URL path',
          onClick: () => {
            navigator.clipboard?.writeText(`${location.origin}${pathToUrl(path)}`).catch(() => {});
            notify('URL copied');
          },
        },
        { label: 'Open version history', icon: 'clock', onClick: () => setVersionHistory(path) },
        ...(isMd
          ? [
              {
                label: 'Open linked view',
                icon: 'arrow-up-right',
                submenu: [
                  { label: 'Backlinks', icon: 'link', onClick: () => void inTab(path, () => setRightPanel('backlinks')) },
                  { label: 'Outgoing links', icon: 'arrow-up-right', onClick: () => void inTab(path, () => setRightPanel('outgoing')) },
                  { label: 'Outline', icon: 'list', onClick: () => void inTab(path, () => setRightPanel('outline')) },
                ],
              },
            ]
          : []),
        sep,
        {
          label: 'Reveal file in navigation',
          icon: 'folder',
          onClick: () => {
            revealInTree(path);
            if (isMobile) setMobileDrawer('left');
          },
        },
        ...(isShareable ? [{ label: 'Share…', icon: 'globe', onClick: () => setShareDialog(path) }] : []),
        sep,
        ...tabItems,
        sep,
        {
          label: 'Delete',
          danger: true,
          icon: 'trash',
          onClick: async () => {
            if (confirm(`Delete "${baseName}"?`)) {
              const r = await api.remove(path);
              closeTab(path);
              await loadTree();
              notify(r.deleted ? 'Deleted permanently' : 'Moved to trash');
            }
          },
        },
      ];
    }
    openContextMenu({ x: e.clientX || Math.round(rect.left), y: e.clientY || Math.round(rect.bottom), items });
  };

  return (
    <header className="tab-bar">
      <button type="button" className="tab-new tab-ctl"
        title={isMobile ? 'Open menu' : 'Toggle left sidebar (Ctrl/⌘\\)'}
        aria-label="Toggle left sidebar" aria-expanded={isMobile ? mobileDrawer === 'left' : leftOpen}
        onClick={() => (isMobile ? setMobileDrawer(mobileDrawer === 'left' ? null : 'left') : toggleLeft())}>
        <Icon name={isMobile ? 'menu' : 'panel-left'} size={16} />
      </button>
      <div className="tab-scroll" role="tablist" aria-label="Open files" ref={scroll}>
        {tabs.map((tab) => (
          <div key={tab.path} className={`tab ${activePath === tab.path ? 'active' : ''}`}
            role="tab" aria-selected={activePath === tab.path} tabIndex={activePath === tab.path ? 0 : -1}
            onClick={() => void openFile(tab.path)}
            onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); closeTab(tab.path); } }}
            onContextMenu={(event) => openTabMenu(event, tab.path)}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault(); void openFile(tab.path);
              } else if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                const index = tabs.indexOf(tab);
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
                  : (index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
                (scroll.current?.children[next] as HTMLElement | undefined)?.focus();
                void openFile(tabs[next].path);
              }
            }}
            title={tab.path}>
            {tab.path === GRAPH_PATH && <Icon name="graph" size={13} />}
            <span className="title">{tab.title.replace(/\.(md|markdown)$/, '')}</span>
            {dirty && activePath === tab.path && <span className="dot" aria-label="Unsaved changes">●</span>}
            <button type="button" className="close" title="Close tab" aria-label={`Close ${tab.title}`}
              onClick={(event) => { event.stopPropagation(); closeTab(tab.path); }}>
              <Icon name="x" size={13} />
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="tab-new tab-ctl" title="New note (Ctrl/⌘N)" aria-label="New note"
        onClick={() => void newNote()}>
        <Icon name="plus" size={16} />
      </button>
      <div className="titlebar-drag-space" />
      <button type="button" className="tab-new tab-ctl" title="Toggle right sidebar"
        aria-label="Toggle right sidebar" aria-expanded={isMobile ? mobileDrawer === 'right' : rightOpen}
        onClick={() => (isMobile ? setMobileDrawer(mobileDrawer === 'right' ? null : 'right') : toggleRight())}>
        <Icon name="panel-right" size={16} />
      </button>
    </header>
  );
}
