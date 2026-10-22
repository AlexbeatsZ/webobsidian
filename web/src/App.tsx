import { ensureWriting, writingFileChanged, watchExternalWritingSources } from './lib/writing/config';
import { runWritingHotkey, bindWritingNavigation } from './lib/writing/commands';
import { refreshSearch, searchSettings } from './lib/search';
import { useEffect, useLayoutEffect, useState } from 'react';
import { api, ApiError, invalidateVaultRequests } from './lib/api';
import { useStore } from './lib/store';
import Login from './components/Login';
import ForceChangePassword from './components/ForceChangePassword';
import Ribbon from './components/Ribbon';
import Sidebar from './components/Sidebar';
import RightSidebar from './components/RightSidebar';
import Workspace from './components/Workspace';
import WorkspaceTabs from './components/WorkspaceTabs';
import CommandPalette from './components/CommandPalette';
import Settings from './components/Settings';
import ShareDialog from './components/ShareDialog';
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
import { clearNativeFeaturePreferences } from './lib/nativeFeaturePreferences';

export default function App() {
  const authed = useStore((s) => s.authed);
  const setAuthed = useStore((s) => s.setAuthed);
  const mustChangePassword = useStore((s) => s.mustChangePassword);
  const setMustChangePassword = useStore((s) => s.setMustChangePassword);
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
  const [checking, setChecking] = useState(true);
  const [theme, setTheme] = useState<'theme-dark' | 'theme-light'>('theme-light');

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
    api
      .me()
      .then((r) => {
        setMustChangePassword(Boolean(r.mustChangePassword));
        setAuthed(true);
      })
      .catch((e) => {
        if (!(e instanceof ApiError && e.status === 401)) console.error(e);
      })
      .finally(() => setChecking(false));
  }, [setAuthed, setMustChangePassword]);

  useEffect(() => {
    if (!authed) return;
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
      .then((s) => setTheme(s?.ui?.theme === 'obsidian-dark' ? 'theme-dark' : 'theme-light'))
      .catch(() => {});
    useStore.getState().loadShares(); // badge shared notes in the file tree
    loadPlugins().catch(() => {});
    // websocket live updates
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    const stopMaintenance = bindVaultMaintenance(ws);
    let treeTimer: number | undefined;
    let indexTimer: number | undefined;
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'fs') {
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
        } else if (msg.type === 'index') {
          window.clearTimeout(indexTimer);
          indexTimer = window.setTimeout(notifyIndexChanged, 800);
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
      stopUserscripts();
      stopMenus();
      clearNativeFeaturePreferences();
      stopWritingFiles();
      stopWritingNavigation();
    };
  }, [authed, loadTree]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const state = useStore.getState();
      const reserved =
        (e.ctrlKey || e.metaKey) &&
        !e.altKey &&
        ['p', 'o', 's', 'n', 'e', 'f', '\\'].includes(e.key.toLowerCase());
      if (!reserved)
        for (const [id, binding] of Object.entries(searchSettings().shortcuts)) {
          if (!binding) continue;
          const parts = binding.toLowerCase().split('+');
          const key = parts.pop();
          const mac = /Mac|iPhone|iPad/.test(navigator.platform);
          const ctrl = parts.includes('ctrl') || (parts.includes('mod') && !mac),
            meta = parts.includes('meta') || (parts.includes('mod') && mac);
          if (
            key === e.key.toLowerCase() &&
            ctrl === e.ctrlKey &&
            meta === e.metaKey &&
            parts.includes('alt') === e.altKey &&
            parts.includes('shift') === e.shiftKey
          ) {
            if (sharedApp.commands.executeCommandById(id)) {
              e.preventDefault();
              return;
            }
          }
        }
      if (!reserved && runWritingHotkey(e, id => sharedApp.commands.executeCommandById(id))) { e.preventDefault(); return; }
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      const s = useStore.getState();
      if (k === 'p') {
        e.preventDefault();
        setPalette(true, e.shiftKey ? 'commands' : 'commands');
      } else if (k === 'o') {
        e.preventDefault();
        setPalette(true, 'files');
      } else if (k === 's') {
        e.preventDefault();
        sharedApp.commands.executeCommandById('editor:save-file');
      } else if (k === 'n') {
        e.preventDefault();
        s.newNote();
      } else if (k === 'e') {
        e.preventDefault();
        s.setViewMode(s.viewMode === 'reading' ? 'live' : 'reading');
      } else if (k === 'f' && e.shiftKey) {
        e.preventDefault();
        s.setLeftPanel('search');
      } else if (k === '\\') {
        e.preventDefault();
        s.toggleLeft();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setPalette, save]);

  // Mobile: close the overlay drawer once a note is opened (tap note → read it).
  useEffect(() => {
    if (isMobile && useStore.getState().mobileDrawer) setMobileDrawer(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePath]);

  // Mobile: edge-swipe to open/close the drawers (Obsidian Mobile gesture).
  useEffect(() => {
    if (!isMobile) return;
    let sx = 0,
      sy = 0,
      fromLeftEdge = false,
      fromRightEdge = false,
      tracking = false;
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      sx = t.clientX;
      sy = t.clientY;
      fromLeftEdge = sx <= 28;
      fromRightEdge = sx >= window.innerWidth - 28;
      tracking = true;
    };
    const onEnd = (e: TouchEvent) => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - sx,
        dy = t.clientY - sy;
      if (Math.abs(dx) < 45 || Math.abs(dy) > Math.abs(dx)) return; // mostly-horizontal only
      const open = useStore.getState().mobileDrawer;
      if (dx > 0) {
        if (open === 'right') setMobileDrawer(null);
        else if (fromLeftEdge && !open) setMobileDrawer('left');
      } else {
        if (open === 'left') setMobileDrawer(null);
        else if (fromRightEdge && !open) setMobileDrawer('right');
      }
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchend', onEnd);
    };
  }, [isMobile, setMobileDrawer]);

  if (checking) return <div className={theme} style={{ height: '100%' }} />;
  if (!authed)
    return (
      <div className={theme}>
        <Login onAuthed={() => setAuthed(true)} />
      </div>
    );
  // Signed in but still on the default password → block the app until it's changed.
  if (mustChangePassword)
    return (
      <div className={theme}>
        <ForceChangePassword />
      </div>
    );

  // On mobile the sidebars are overlay drawers (always mounted, slid in/out by
  // CSS), driven by the device-local `mobileDrawer` state — not the persisted
  // leftOpen/rightOpen that sync across desktops.
  const showLeft = isMobile || leftOpen;
  const showRight = isMobile || rightOpen;
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
        {showLeft && (
          <Ribbon onTheme={() => setTheme((t) => (t === 'theme-dark' ? 'theme-light' : 'theme-dark'))} />
        )}
        {showLeft && <Sidebar />}
        <Workspace />
        {showRight && <RightSidebar />}
        {isMobile && mobileDrawer && (
          <div className="drawer-backdrop" onClick={() => setMobileDrawer(null)} />
        )}
      </div>
      <CommandPalette />
      <Settings />
      <ShareDialog />
      <VersionHistory />
      <TrashView />
      <AttachmentCleanupDialog host={attachmentDialogHost} />
      <TagOperationsHost />
      <ContextMenu />
      <FolderPicker />
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
