import { Menu, MenuItem } from './ui';
import type { ContextMenuItem } from '../store';
import type { App } from './runtime';
let current: App | undefined;
export function bindPluginMenus(app: App) {
  current = app;
  return () => {
    if (current === app) current = undefined;
  };
}
export function extendFileMenu(
  items: ContextMenuItem[],
  paths: string[]
): ContextMenuItem[] {
  if (!current) return items;
  const menu = new Menu();
  const add = (input: ContextMenuItem[], parent: Menu) => {
    for (const item of input) {
      if (item.separator) {
        parent.addSeparator();
        continue;
      }
      parent.addItem((m) => {
        m.setTitle(item.label);
        if (item.icon) m.setIcon(item.icon);
        m.onClick(() => item.onClick?.());
        if (item.submenu) add(item.submenu, m.setSubmenu());
      });
    }
  };
  add(items, menu);
  const files = paths
    .map((path) => current!.vault.getAbstractFileByPath(path))
    .filter(Boolean);
  if (files.length === 1)
    current.workspace.trigger('file-menu', menu, files[0], 'file-explorer');
  else if (files.length > 1)
    current.workspace.trigger('files-menu', menu, files, 'file-explorer');
  const convert = (menu: Menu): ContextMenuItem[] =>
    menu.items.map((item) =>
      item instanceof MenuItem
        ? {
            label: item.title,
            icon: item.icon,
            onClick: item.disabled
              ? undefined
              : () => item.callback?.(new MouseEvent('click')),
            submenu: item.submenu ? convert(item.submenu) : undefined,
          }
        : { label: '', separator: true }
    );
  return convert(menu);
}
