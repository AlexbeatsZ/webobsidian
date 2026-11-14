// Preload supplies native chrome; React shares the compact workspace tab row.
import { contextBridge, ipcRenderer } from 'electron';
import { installTitleBar } from './titlebar';
import type { DesktopBridge } from './bridge';
import type { McpConnectionInput } from './mcpLauncher';

const nativeArg = process.argv.find(arg => arg.startsWith('--webobsidian-native-vault='));
const desktopApi: DesktopBridge = {
  isDesktop: true,
  platform: process.platform,
  version: process.argv.find(arg => arg.startsWith('--webobsidian-version='))?.split('=')[1] ?? '',
  nativePlugins: !!nativeArg,
  mcp: {
    inspect: () => ipcRenderer.invoke('desktop:mcp-inspect'),
    configure: (input: McpConnectionInput) => ipcRenderer.invoke('desktop:mcp-configure', input),
    copyConfig: () => ipcRenderer.invoke('desktop:mcp-copy-config'),
    connect: () => ipcRenderer.invoke('desktop:mcp-connect'),
  },
  openVaultPath: (path: string): Promise<void> => ipcRenderer.invoke('desktop:open-vault-path', path),
  revealVaultPath: (path: string): Promise<void> => ipcRenderer.invoke('desktop:reveal-vault-path', path),
  setChrome: (dark, workspace) => {
    document.documentElement.dataset.nativeDark = String(dark);
    document.documentElement.dataset.nativeWorkspace = String(workspace);
    window.dispatchEvent(new Event('desktop:chrome'));
  },
  onBeforeClose: (listener: () => Promise<void>) => {
    const handler = (_event: unknown, token: string) => {
      void Promise.resolve().then(listener).then(
        () => ipcRenderer.send('desktop:close-result', token, { ok: true }),
        error => ipcRenderer.send('desktop:close-result', token, { ok: false, error: String(error) }),
      );
    };
    ipcRenderer.on('desktop:prepare-close', handler);
    ipcRenderer.send('desktop:renderer-ready', true);
    return () => {
      ipcRenderer.removeListener('desktop:prepare-close', handler);
      ipcRenderer.send('desktop:renderer-ready', false);
    };
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
  ipcRenderer.on('desktop:server-stopped', () => window.dispatchEvent(new Event('webobsidian-server-stopped')));
  ipcRenderer.on('desktop:close-cancelled', () => window.dispatchEvent(new Event('desktop-close-cancelled')));
  window.addEventListener('DOMContentLoaded', () => void installTitleBar(), { once: true });
}
