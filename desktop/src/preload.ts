// Desktop chrome is installed by the preload, leaving the browser SPA unchanged.
import { contextBridge } from 'electron';
import { installTitleBar } from './titlebar';

contextBridge.exposeInMainWorld('webobsidianDesktop', {
  isDesktop: true,
  platform: process.platform,
});

if (process.platform !== 'darwin' && process.isMainFrame) {
  window.addEventListener('DOMContentLoaded', () => void installTitleBar(), { once: true });
}
