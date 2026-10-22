import { Menu } from './ui';
import type { ContextMenuItem } from '../store';
import type { App } from './runtime';
import { attachMenuContext } from '../configuredMenus/transform';
import type { ConfiguredMenuItem, MenuContext } from '../configuredMenus/types';
let current: App | undefined;
export function bindPluginMenus(app: App) {
  current = app;
  return () => {
    if (current === app) current = undefined;
  };
}
export function extendFileMenu(
  items: ContextMenuItem[] | ConfiguredMenuItem[],
  paths: string[],
  context: MenuContext = { kind: 'file', source: 'file-explorer', paths },
): ConfiguredMenuItem[] {
  if (!current) return attachMenuContext(items, context);
  const menu = new Menu().setContext(context).loadContextMenuItems(items);
  const files = paths
    .map((path) => current!.vault.getAbstractFileByPath(path))
    .filter(Boolean);
  if (files.length === 1)
    current.workspace.trigger('file-menu', menu, files[0], context.source ?? 'file-explorer');
  else if (files.length > 1)
    current.workspace.trigger('files-menu', menu, files, context.source ?? 'file-explorer');
  return attachMenuContext(menu.toContextMenuItems(), context);
}

/** Editor/link/tag adapters can contribute before the shared renderer applies rules. */
export function extendEditorMenu(items: ConfiguredMenuItem[], context: MenuContext, editor: unknown, view: unknown): ConfiguredMenuItem[] {
  if (!current) return attachMenuContext(items, context);
  const menu = new Menu().setContext(context).loadContextMenuItems(items);
  current.workspace.trigger('editor-menu', menu, editor, view);
  return attachMenuContext(menu.toContextMenuItems(), context);
}
