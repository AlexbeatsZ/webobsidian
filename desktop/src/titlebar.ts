import { ipcRenderer } from 'electron';

interface DesktopMenu {
  id: number;
  label: string;
}

/** One compact menu row; native overlay supplies the window controls. */
export async function installTitleBar(): Promise<void> {
  const root = document.getElementById('root');
  if (!root) return;

  const style = document.createElement('style');
  style.textContent = `
    body > .desktop-titlebar {
      height: 32px; box-sizing: border-box; display: flex; align-items: stretch;
      background: #f6f6f6; color: #333; user-select: none; -webkit-app-region: drag;
      font: 13px "Segoe UI", system-ui, sans-serif;
    }
    body > .desktop-titlebar[data-dark="true"] { background: #262626; color: #dadada; }
    body > .desktop-titlebar + #root { height: calc(100% - 32px); }
    .desktop-titlebar-menus {
      display: flex; align-items: center; gap: 0; padding: 0 4px;
      margin-left: env(titlebar-area-x, 0px);
      width: env(titlebar-area-width, calc(100% - 150px));
      box-sizing: border-box; overflow: hidden;
    }
    .desktop-titlebar-menus > button {
      -webkit-app-region: no-drag; flex: none; height: 26px; margin: 0;
      padding: 0 9px; border: 0; border-radius: 4px; background: transparent;
      color: inherit; font: inherit; cursor: default;
    }
    .desktop-titlebar-menus > button:hover,
    .desktop-titlebar-menus > button[aria-expanded="true"] { background: #00000012; }
    .desktop-titlebar[data-dark="true"] .desktop-titlebar-menus > button:hover,
    .desktop-titlebar[data-dark="true"] .desktop-titlebar-menus > button[aria-expanded="true"] { background: #ffffff12; }
    .desktop-titlebar-menus > button:focus-visible { outline: 1px solid currentColor; outline-offset: -2px; }
  `;
  document.head.append(style);

  const bar = document.createElement('header');
  bar.className = 'desktop-titlebar';
  const menus = document.createElement('nav');
  menus.className = 'desktop-titlebar-menus';
  menus.setAttribute('role', 'menubar');
  menus.setAttribute('aria-label', 'Application menu');
  bar.append(menus);
  root.before(bar);

  // Observe only the app's theme wrapper, rather than every editor DOM change.
  let lastDark: boolean | undefined;
  const syncTheme = () => {
    const dark = root.firstElementChild?.classList.contains('theme-dark') ?? false;
    if (dark === lastDark) return;
    lastDark = dark;
    bar.dataset.dark = String(dark);
    ipcRenderer.send('desktop:titlebar-theme', dark);
  };
  const themeObserver = new MutationObserver(syncTheme);
  const watchTheme = () => {
    themeObserver.disconnect();
    if (root.firstElementChild) themeObserver.observe(root.firstElementChild, { attributes: true, attributeFilter: ['class'] });
    syncTheme();
  };
  new MutationObserver(watchTheme).observe(root, { childList: true });
  watchTheme();

  const items: DesktopMenu[] = await ipcRenderer.invoke('desktop:menu-items');
  const buttons: HTMLButtonElement[] = [];
  let opening = false;
  let contentFocus: HTMLElement | null = null;
  const restoreFocus = () => {
    contentFocus?.focus({ preventScroll: true });
    contentFocus = null;
  };
  const focusMenu = (index: number) => {
    if (!menus.contains(document.activeElement)) contentFocus = document.activeElement as HTMLElement | null;
    buttons.forEach((button, i) => { button.tabIndex = i === index ? 0 : -1; });
    buttons[index]?.focus();
  };
  const openMenu = async (index: number) => {
    if (opening) return;
    const button = buttons[index];
    const rect = button.getBoundingClientRect();
    restoreFocus(); // Edit menu actions must target the editor, not the menu button.
    opening = true;
    button.setAttribute('aria-expanded', 'true');
    try {
      await ipcRenderer.invoke('desktop:open-menu', items[index].id, rect.left, rect.bottom + 3);
    } finally {
      button.setAttribute('aria-expanded', 'false');
      opening = false;
    }
  };

  items.forEach((item, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = item.label;
    button.tabIndex = index === 0 ? 0 : -1;
    button.setAttribute('role', 'menuitem');
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => void openMenu(index));
    buttons.push(button);
    menus.append(button);
  });

  let altOnly = false;
  window.addEventListener('keydown', (event) => {
    if (!buttons.length || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Alt') { altOnly = true; event.preventDefault(); return; }
    altOnly = false;
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'F10' && !event.shiftKey) {
      event.preventDefault();
      if (index < 0) focusMenu(0); else restoreFocus();
    } else if (event.altKey && !event.shiftKey) {
      const target = items.findIndex((item) => item.label[0].toLowerCase() === event.key.toLowerCase());
      if (target >= 0) { event.preventDefault(); void openMenu(target); }
    } else if (index >= 0) {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        focusMenu((index + (event.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length);
      } else if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        void openMenu(index);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        restoreFocus();
      }
    }
  });
  window.addEventListener('keyup', (event) => {
    if (event.key === 'Alt' && altOnly && buttons.length) {
      event.preventDefault();
      if (menus.contains(document.activeElement)) restoreFocus(); else focusMenu(0);
    }
    altOnly = false;
  });
}
