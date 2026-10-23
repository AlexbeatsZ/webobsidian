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
  openVaultPath: (path: string): Promise<void> => ipcRenderer.invoke('desktop:open-vault-path', path),
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
  window.addEventListener('DOMContentLoaded', () => void installTitleBar(), { once: true });
}
}
