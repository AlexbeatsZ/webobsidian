// Preload supplies native chrome; React shares the compact workspace tab row.
import { contextBridge, ipcRenderer } from 'electron';
import { installTitleBar } from './titlebar';
import { installGuestUserscripts } from './userscripts/guest';

if (process.argv.includes('--webobsidian-userscript-guest')) {
  installGuestUserscripts();
} else {
const nativeArg = process.argv.find(arg => arg.startsWith('--webobsidian-native-vault='));
const desktopApi = {
  isDesktop: true,
  platform: process.platform,
  nativePlugins: !!nativeArg,
  mcp: {
    inspect: () => ipcRenderer.invoke('desktop:mcp-inspect'),
    selectProject: () => ipcRenderer.invoke('desktop:mcp-select-project'),
    run: (action: 'Start' | 'Restart' | 'Status') => ipcRenderer.invoke('desktop:mcp-run', action),
  },
  openVaultPath: (path: string): Promise<void> => ipcRenderer.invoke('desktop:open-vault-path', path),
  onBeforeClose: (listener: () => Promise<void>) => {
    const handler = (_event: unknown, token: string) => {
      void Promise.resolve().then(listener).then(
        () => ipcRenderer.send('desktop:close-result', token, { ok: true }),
        error => ipcRenderer.send('desktop:close-result', token, { ok: false, error: String(error) }),
      );
    };
    ipcRenderer.on('desktop:prepare-close', handler);
    return () => ipcRenderer.removeListener('desktop:prepare-close', handler);
  },
  webviewer: {
    subscribe: (listener: (page: { sourceGuestId: number; url: string }) => void) => {
      const handler = (_event: unknown, page: { sourceGuestId: number; url: string }) => listener(page);
      ipcRenderer.on('webviewer:open-tab', handler);
      return () => ipcRenderer.removeListener('webviewer:open-tab', handler);
    },
  },
  userscripts: {
    request: (action: string, payload?: unknown) => ipcRenderer.invoke('userscripts:manage', action, payload ?? {}),
    subscribe: (listener: () => void) => {
      const handler = () => listener();
      ipcRenderer.on('userscripts:changed', handler);
      return () => ipcRenderer.removeListener('userscripts:changed', handler);
    },
  },
  vaultPath: nativeArg ? decodeURIComponent(nativeArg.slice('--webobsidian-native-vault='.length)) : undefined,
};
if (process.contextIsolated) contextBridge.exposeInMainWorld('webobsidianDesktop', desktopApi);
else {
  Object.defineProperty(window, 'webobsidianDesktop', { value: desktopApi });
  // Only present in the explicitly trusted, local desktop renderer.
  Object.defineProperty(window, 'webobsidianNativeRequire', { value: require });
}

if (process.isMainFrame) {
  ipcRenderer.on('desktop:command', (_event, command: string) => {
    window.dispatchEvent(new CustomEvent('desktop-command', { detail: command }));
  });
  ipcRenderer.on('desktop:close-cancelled', () => window.dispatchEvent(new Event('desktop-close-cancelled')));
  window.addEventListener('DOMContentLoaded', () => void installTitleBar(), { once: true });
}
}
