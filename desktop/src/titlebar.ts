import { ipcRenderer } from 'electron';

/** React owns the tab/title row; preload only maintains native desktop chrome. */
export function installTitleBar(): void {
  const root = document.getElementById('root');
  if (!root) return;
  document.documentElement.dataset.desktopTitlebar = 'true';
  document.documentElement.dataset.desktopPlatform = process.platform;
  ipcRenderer.on('desktop:fullscreen', (_event, fullscreen: boolean) => {
    document.documentElement.toggleAttribute('data-desktop-fullscreen', fullscreen);
  });

  // Keep loading/login screens draggable before the workspace tab row mounts.
  const style = document.createElement('style');
  style.textContent = `
    .desktop-titlebar-fallback {
      position: fixed; top: 0; left: 0; right: 0; height: 32px; z-index: 100;
      background: #f6f6f6; -webkit-app-region: drag;
    }
    .desktop-titlebar-fallback[data-dark="true"] { background: #262626; }
    .desktop-titlebar-fallback[hidden] { display: none; }
  `;
  document.head.append(style);
  const fallback = document.createElement('div');
  fallback.className = 'desktop-titlebar-fallback';
  fallback.setAttribute('aria-hidden', 'true');
  root.before(fallback);

  // Observe the theme wrapper's class/direct children, never the editor subtree.
  let lastDark: boolean | undefined;
  const syncChrome = () => {
    const wrapper = root.firstElementChild;
    fallback.hidden = !!wrapper?.querySelector(':scope > .app');
    const dark = wrapper?.classList.contains('theme-dark') ?? false;
    if (dark === lastDark) return;
    lastDark = dark;
    fallback.dataset.dark = String(dark);
    if (process.platform !== 'darwin') ipcRenderer.send('desktop:titlebar-theme', dark);
  };
  const themeObserver = new MutationObserver(syncChrome);
  const watchTheme = () => {
    themeObserver.disconnect();
    if (root.firstElementChild) themeObserver.observe(root.firstElementChild, {
      attributes: true, attributeFilter: ['class'], childList: true,
    });
    syncChrome();
  };
  new MutationObserver(watchTheme).observe(root, { childList: true });
  watchTheme();

  // Preserve access to vault/window actions without displaying File/Edit labels.
  let opening = false;
  window.addEventListener('keydown', (event) => {
    if (process.platform === 'darwin' || event.defaultPrevented || event.key !== 'F10' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
    event.preventDefault();
    if (opening) return;
    opening = true;
    void ipcRenderer.invoke('desktop:open-application-menu').finally(() => { opening = false; });
  });
}
