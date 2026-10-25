import { ensureWriting, writingFileChanged, watchExternalWritingSources } from './lib/writing/config';
import { bindWritingNavigation } from './lib/writing/commands';
import { refreshSearch, searchSettings } from './lib/search';
import { useEffect, useLayoutEffect, useState } from 'react';
import { api, invalidateVaultRequests } from './lib/api';
import { useStore, flushWorkspaceState, saveWorkspaceBeforeExit, workspaceHasUnsavedChanges } from './lib/store';
import Ribbon from './components/Ribbon';
import Sidebar from './components/Sidebar';
import RightSidebar from './components/RightSidebar';
import SidebarDock from './components/SidebarDock';
import Workspace from './components/Workspace';
import WorkspaceTabs from './components/WorkspaceTabs';
import CommandPalette from './components/CommandPalette';
import Settings from './components/Settings';
import VersionHistory from './components/VersionHistory';
import TrashView from './components/TrashView';
import ContextMenu from './components/ContextMenu';
import FolderPicker from './components/FolderPicker';
import { loadPlugins, sharedApp } from './lib/plugins';
import { initUrlSync } from './lib/urlsync';
import { useIsMobile } from './lib/useIsMobile';
import { notifyIndexChanged } from './lib/indexEvents';
import { bindVaultMaintenance } from './lib/vaultMaintenance';
import { bootstrapUserscripts, refreshUserscripts } from './lib/userscripts/client';
import { initializeNativeMenus, attachmentDialogHost, readNativeFeatures } from './lib/nativeFeatures';
import { notifyMenuConfigurationFileChanged } from './lib/configuredMenus/controller';
import AttachmentCleanupDialog from './components/AttachmentCleanupDialog';
import TagOperationsHost from './components/TagOperationsHost';
import ReviewHost from './components/ReviewHost';
import { bindOperationWorkspace } from './lib/review/client';
import { clearNativeFeaturePreferences } from './lib/nativeFeaturePreferences';
import { documents } from './lib/documents';
import { initializePropertyTypes } from './lib/propertyTypes';
import { configureDebug, debugEnabled, recordDebug } from './lib/debug';

export default function App() {
  const loadTree = useStore((s) => s.loadTree);
  const leftOpen = useStore((s) => s.leftOpen);
  const rightOpen = useStore((s) => s.rightOpen);
  const mobileDrawer = useStore((s) => s.mobileDrawer);
  const setMobileDrawer = useStore((s) => s.setMobileDrawer);
  const activePath = useStore((s) => s.activePath);
  const isMobile = useIsMobile();
  const setPalette = useStore((s) => s.setPalette);
  const save = useStore((s) => s.save);
  const toast = useStore((s) => s.toast);
  const [theme, setTheme] = useState<'theme-dark' | 'theme-light'>('theme-light');

  useEffect(() => documents.subscribe(snapshot => {
    if (debugEnabled()) recordDebug('document.state', { path: snapshot.id, version: snapshot.version,
      dirty: snapshot.dirty, saving: snapshot.saving, locked: snapshot.locked, conflict: Boolean(snapshot.conflict), revision: snapshot.revision });
  }), []);

  useLayoutEffect(() => {
    // Plugin modals/notices/suggesters mount outside React's theme wrapper.
    const body = document.body;
    const previous = ['theme-light', 'theme-dark'].filter(name => body.classList.contains(name));
    body.classList.remove('theme-light', 'theme-dark');
    body.classList.add(theme);
    return () => {
      body.classList.remove('theme-light', 'theme-dark');
      body.classList.add(...previous);
    };
  }, [theme]);

  useEffect(() => {
    const stopUserscripts = bootstrapUserscripts();
    let stopMenus = initializeNativeMenus();
    void readNativeFeatures().then(value => { attachmentDialogHost.initialOptions = value.attachments; }).catch(console.error);
    loadTree();
    void refreshSearch().catch(console.error);
    const stopWritingFiles=watchExternalWritingSources();
    const stopWritingNavigation=bindWritingNavigation();
    void ensureWriting().catch(error=>useStore.getState().notify(String(error)));
    // Deep link (/note/<path>) wins over the restored workspace's active note.
    const deepLink = initUrlSync();
    useStore
      .getState()
      .loadUiState() // restore workspace from server + open note(s)
      .then(() => {
        if (deepLink && deepLink !== useStore.getState().activePath) {
          return useStore.getState().openFile(deepLink);
        }
      })
      .catch(() => {});
    api
      .getSettings()
      .then((s) => { setTheme(s?.ui?.theme === 'obsidian-dark' ? 'theme-dark' : 'theme-light'); configureDebug(Boolean(s?.ui?.debugRecording), s?.ui?.debugSource !== false); })
      .catch(() => {});
    loadPlugins().catch(() => {});
    // websocket live updates
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    const stopMaintenance = bindVaultMaintenance(ws);
    const stopOperations = bindOperationWorkspace(ws);
    const stopPropertyTypes = initializePropertyTypes(error => useStore.getState().notify(String(error)));
    let treeTimer: number | undefined;
    let indexTimer: number | undefined;
    ws.onmessage = async (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'fs') {
          if (msg.event === 'change' && documents.get(msg.path)) {
            try { await documents.refresh(msg.path); }
            catch (error) { useStore.getState().notify(String(error)); }
          }
          writingFileChanged(msg.path);
          notifyMenuConfigurationFileChanged(msg.path);
          // Content saves update one stat; structure/unknown paths refresh the tree.
          if (!(
            msg.event === 'change' &&
            msg.stat &&
            useStore.getState().applyFileStat(msg.path, msg.stat)
          )) {
            window.clearTimeout(treeTimer);
            treeTimer = window.setTimeout(() => loadTree(), 800);
          }
        } else if (msg.type === 'vault-changed') {
          invalidateVaultRequests();
          useStore.setState({ vaultSessionStale: true });
          useStore.getState().notify('Vault 已切换，请重新加载应用后继续编辑；当前文档会话暂时保留。', 0);
          clearNativeFeaturePreferences();
          stopMenus();
          stopMenus = initializeNativeMenus();
          void refreshUserscripts().catch(error => useStore.getState().notify(String(error)));
          window.dispatchEvent(new Event('vault-changed'));
          void readNativeFeatures().then(value => { attachmentDialogHost.initialOptions = value.attachments; }).catch(console.error);
          loadTree();
          notifyIndexChanged();
        } else if (msg.type === 'native-features-changed') {
          void readNativeFeatures().catch(error => useStore.getState().notify(String(error)));
          notifyIndexChanged();
        } else if (msg.type === 'automation-changed') {
          void sharedApp.automation.reload().catch(error => useStore.getState().notify(String(error)));
        } else if (msg.type === 'vault-configuration-changed') {
          writingFileChanged(msg.path);
          if (msg.path === '.obsidian/webobsidian/automation.jsonc')
            void sharedApp.automation.reload().catch(error => useStore.getState().notify(String(error)));
          window.dispatchEvent(new CustomEvent('vault-configuration-changed', { detail: { path: msg.path, event: msg.event } }));
        } else if (msg.type === 'index') {
          window.clearTimeout(indexTimer);
          indexTimer = window.setTimeout(notifyIndexChanged, 800);
        } else if (msg.type === 'index-error') {
          useStore.getState().notify(`文件索引失败：${msg.path}；已保存内容保留。${msg.error}`, 0);
        } else if (msg.type === 'uistate') {
          // another tab/device changed the workspace → sync live
          useStore.getState().applyRemoteState(msg.state, msg.originId);
        }
      } catch {
        /* ignore */
      }
    };
    return () => {
      window.clearTimeout(treeTimer);
      window.clearTimeout(indexTimer);
      ws.close();
      stopMaintenance();
      stopOperations();
      stopUserscripts();
      stopPropertyTypes();
      stopMenus();
      clearNativeFeaturePreferences();
      stopWritingFiles();
      stopWritingNavigation();
    };
  }, [loadTree]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!sharedApp.commands.dispatchHotkey(e)) return;
      e.preventDefault(); e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  useEffect(() => {
    const command = (event: Event) => {
      const id = (event as CustomEvent<unknown>).detail;
      if (typeof id === 'string' && ['new', 'files', 'save', 'settings', 'vault-switch'].includes(id)) sharedApp.commands.executeCommandById(id);
    };
    const save = () => {
      for (const snapshot of documents.snapshots()) {
        if (snapshot.dirty && !snapshot.conflict && !snapshot.locked) void documents.get(snapshot.id)?.save().catch(error => useStore.getState().notify(String(error)));
      }
      void flushWorkspaceState().catch(() => {});
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      const state = useStore.getState();
      if (workspaceHasUnsavedChanges() || state.pendingCanvasEdits || state.dirty ||
          documents.snapshots().some(snapshot => snapshot.dirty || snapshot.saving || snapshot.conflict || snapshot.locked)) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    let closeGeneration = 0;
    let releaseClose: (() => void) | undefined;
    const cancelClose = () => { closeGeneration++; releaseClose?.(); releaseClose = undefined; };
    const stopClose = window.webobsidianDesktop?.onBeforeClose?.(async () => {
      const generation = ++closeGeneration;
      const root = document.getElementById('root');
      const previousInert = root?.inert ?? false;
      if (root) root.inert = true;
      releaseClose = () => { if (root) root.inert = previousInert; };
      try {
        await saveWorkspaceBeforeExit();
        if (generation !== closeGeneration) throw new Error('关闭请求已取消');
      } catch (error) {
        if (generation === closeGeneration) {
          cancelClose();
          useStore.getState().notify(`关闭已取消：${String(error)}`, 0);
        }
        throw error;
      }
    });
    const hidden = () => { if (document.visibilityState === 'hidden') save(); };
    window.addEventListener('desktop-command', command);
    window.addEventListener('webobsidian-background', save);
    window.addEventListener('pagehide', save);
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('desktop-close-cancelled', cancelClose);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('desktop-command', command);
      window.removeEventListener('webobsidian-background', save);
      window.removeEventListener('pagehide', save);
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('desktop-close-cancelled', cancelClose);
      stopClose?.();
      cancelClose();
      document.removeEventListener('visibilitychange', hidden);
    };
  }, []);

  // Mobile: close the overlay drawer once a note is opened (tap note → read it).
  useEffect(() => {
    if (isMobile && useStore.getState().mobileDrawer) setMobileDrawer(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePath]);

  // Mobile: edge-swipe to open/close the drawers (Obsidian Mobile gesture).
  useEffect(() => {
    if (!isMobile) return;
    let gesture: { id: number; x: number; y: number; time: number; open: 'left' | 'right' | null; edge: 'left' | 'right' | null; horizontal: boolean } | undefined;
    const cancel = () => { gesture = undefined; };
    const onStart = (e: TouchEvent) => {
      cancel();
      if (e.defaultPrevented || e.touches.length !== 1) return;
      const t = e.touches[0];
      const target = e.target instanceof Element ? e.target : null;
      const open = useStore.getState().mobileDrawer;
      const edge = t.clientX <= 28 ? 'left' : t.clientX >= window.innerWidth - 28 ? 'right' : null;
      if ((!open && !edge) || target?.closest('input, textarea, select, [contenteditable="true"], .canvas-view') && !edge) return;
      if (!window.getSelection()?.isCollapsed) return;
      // Horizontal tables/code/tab strips keep their native scrolling.
      for (let node = target; node && node !== document.body; node = node.parentElement) {
        if (node.scrollWidth > node.clientWidth + 2 && /auto|scroll/.test(getComputedStyle(node).overflowX)) return;
      }
      if (open && !target?.closest('.sidebar-dock, .drawer-backdrop')) return;
      gesture = { id: t.identifier, x: t.clientX, y: t.clientY, time: performance.now(), open, edge, horizontal: false };
    };
    const onMove = (e: TouchEvent) => {
      if (!gesture) return;
      if (e.touches.length !== 1) { cancel(); return; }
      const t = e.touches[0];
      const dx = t.clientX - gesture.x, dy = t.clientY - gesture.y;
      if (!gesture.horizontal) {
        if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) { cancel(); return; }
        if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
        const side = gesture.open ?? gesture.edge;
        if ((side === 'left' && (gesture.open ? dx > 0 : dx < 0)) || (side === 'right' && (gesture.open ? dx < 0 : dx > 0))) { cancel(); return; }
        gesture.horizontal = true;
      }
      if (e.cancelable) e.preventDefault();
    };
    const onEnd = (e: TouchEvent) => {
      const current = gesture; cancel();
      if (!current || e.touches.length || performance.now() - current.time > 900) return;
      const t = Array.from(e.changedTouches).find(touch => touch.identifier === current.id);
      if (!t) return;
      const dx = t.clientX - current.x, dy = t.clientY - current.y;
      if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.3 || useStore.getState().mobileDrawer !== current.open) return;
      if (current.open === 'left' && dx < 0 || current.open === 'right' && dx > 0) setMobileDrawer(null);
      else if (!current.open && (current.edge === 'left' && dx > 0 || current.edge === 'right' && dx < 0)) setMobileDrawer(current.edge);
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd, { passive: true });
    window.addEventListener('touchcancel', cancel);
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', cancel);
    };
  }, [isMobile, setMobileDrawer]);

  // Both sidebars float; mobile visibility stays device-local. Keep guest hosts
  // mounted when hidden so changing panels doesn't restart a web page.
  const showLeft = isMobile ? mobileDrawer === 'left' : leftOpen;
  const showRight = isMobile ? mobileDrawer === 'right' : rightOpen;
  const appCls = [
    'app',
    leftOpen ? '' : 'left-closed',
    rightOpen ? '' : 'right-closed',
    isMobile ? 'mobile' : '',
    isMobile && mobileDrawer === 'left' ? 'drawer-left-open' : '',
    isMobile && mobileDrawer === 'right' ? 'drawer-right-open' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={theme}>
      <div className={appCls}>
        <WorkspaceTabs />
        <SidebarDock side="left" open={showLeft} rail={<Ribbon />}>
          {presented => <Sidebar open={presented} />}
        </SidebarDock>
        <Workspace />
        <RightSidebar open={showRight} />
        {isMobile && mobileDrawer && (
          <div className="drawer-backdrop" onClick={() => setMobileDrawer(null)} />
        )}
      </div>
      <CommandPalette />
      <Settings />
      <VersionHistory />
      <TrashView />
      <AttachmentCleanupDialog host={attachmentDialogHost} />
      <TagOperationsHost />
      <ReviewHost />
      <ContextMenu />
      <FolderPicker />
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
