// Preload supplies native chrome; React shares the compact workspace tab row.
import { contextBridge } from 'electron';
import { installTitleBar } from './titlebar';

const nativeArg = process.argv.find(arg => arg.startsWith('--webobsidian-native-vault='));
const desktopApi = {
  isDesktop: true,
  platform: process.platform,
  nativePlugins: !!nativeArg,
  vaultPath: nativeArg ? decodeURIComponent(nativeArg.slice('--webobsidian-native-vault='.length)) : undefined,
};
if (process.contextIsolated) contextBridge.exposeInMainWorld('webobsidianDesktop', desktopApi);
else {
  Object.defineProperty(window, 'webobsidianDesktop', { value: desktopApi });
  // Only present in the explicitly trusted, local desktop renderer.
  Object.defineProperty(window, 'webobsidianNativeRequire', { value: require });
}

if (process.platform !== 'darwin' && process.isMainFrame) {
  window.addEventListener('DOMContentLoaded', () => void installTitleBar(), { once: true });
}
