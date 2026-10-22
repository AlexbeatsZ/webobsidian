import type { CompiledAddition, CompiledMenuConfig, ConfiguredMenuItem, MenuCommandHost, MenuContext, MenuMatch } from './types';

const normalizeTitle = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

export function snapshotMenuContext(context: MenuContext): MenuContext {
  return Object.freeze({
    ...context,
    paths: context.paths && Object.freeze([...context.paths]),
    fileTypes: context.fileTypes && Object.freeze([...context.fileTypes]),
    selection: context.selection && Object.freeze({ ...context.selection }),
    modifiers: Object.freeze({ shift: false, ctrl: false, alt: false, meta: false, ...context.modifiers }),
  });
}

export function menuModifiers(event: Pick<MouseEvent, 'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey'>): MenuContext['modifiers'] {
  return { shift: event.shiftKey, ctrl: event.ctrlKey, alt: event.altKey, meta: event.metaKey };
}

/** Metadata lives only as long as the actual menu array, never an observed-item catalog. */
const contexts = new WeakMap<readonly ConfiguredMenuItem[], MenuContext>();
export function attachMenuContext<T extends ConfiguredMenuItem[]>(items: T, context: MenuContext): T {
  contexts.set(items, snapshotMenuContext(context));
  return items;
}
export const getMenuContext = (items: readonly ConfiguredMenuItem[]) => contexts.get(items);

function matches(item: ConfiguredMenuItem, match: MenuMatch) {
  if (match.id !== undefined) return Boolean(item.id && (Array.isArray(match.id) ? match.id.includes(item.id) : match.id === item.id));
  const weak = match.weak;
  return Boolean(!item.id && weak && normalizeTitle(item.label) === normalizeTitle(weak.title)
    && (weak.icon === undefined || (item.icon ?? '') === weak.icon)
    && (weak.section === undefined || (item.section ?? '') === weak.section));
}

function walk(items: ConfiguredMenuItem[], visit: (item: ConfiguredMenuItem, parent: ConfiguredMenuItem[]) => void) {
  for (const item of [...items]) {
    visit(item, items);
    if (item.submenu) walk(item.submenu, visit);
  }
}

/** No IO or async work: each open transforms a fresh copy of the completed menu. */
export function transformMenu(
  input: readonly ConfiguredMenuItem[],
  config: CompiledMenuConfig,
  context: MenuContext,
  host?: MenuCommandHost,
): ConfiguredMenuItem[] {
  const clone = (items: readonly ConfiguredMenuItem[]): ConfiguredMenuItem[] => items.map((item) => {
    const callback = item.onClick;
    return {
      ...item,
      submenu: item.submenu && clone(item.submenu),
      onClick: callback && host?.isContextCurrent ? (event?: MouseEvent) => {
        if (!host.isContextCurrent!(context)) { host.notify('菜单上下文已改变，请重新打开菜单。'); return; }
        callback(event);
      } : callback,
    };
  });
  const items = clone(input);
  const original = new Map<ConfiguredMenuItem, ConfiguredMenuItem>();
  walk(items, (item) => original.set(item, { ...item }));
  const orders = new Map<ConfiguredMenuItem, number>();
  const hidden = new Set<ConfiguredMenuItem>();
  const ids = new Map<string, ConfiguredMenuItem[]>();
  const index = (item: ConfiguredMenuItem) => {
    if (item.id) ids.set(item.id, [...(ids.get(item.id) ?? []), item]);
  };
  walk(items, index);
  const added = (entries: readonly CompiledAddition[]): ConfiguredMenuItem[] => entries.flatMap(({ item, test, submenu }) => {
    if (!test(context) || ids.has(item.id)) return [];
    const result: ConfiguredMenuItem = { id: item.id, label: item.title ?? '', icon: item.icon, group: item.group, separator: item.separator };
    index(result);
    original.set(result, { ...result });
    if (item.order !== undefined) orders.set(result, item.order);
    if (submenu) result.submenu = added(submenu);
    if (item.command) {
      const id = item.command;
      result.disabled = !host?.hasCommand(id, context);
      result.onClick = () => {
        if (!host) return;
        if (host.isContextCurrent && !host.isContextCurrent(context)) {
          host.notify('菜单上下文已改变，请重新打开菜单。');
          return;
        }
        if (!host.hasCommand(id, context)) { host.notify(`命令当前不可用：${id}`); return; }
        try {
          Promise.resolve(host.executeCommand(id, context)).then((ok) => {
            if (ok === false) host.notify(`命令当前不可用：${id}`);
          }).catch((e) => host.notify(String(e)));
        } catch (e) { host.notify(String(e)); }
      };
    }
    return [result];
  });
  items.push(...added(config.items));

  for (const { rule, test } of config.rules) {
    if (!test(context)) continue;
    const entries: { item: ConfiguredMenuItem; parent: ConfiguredMenuItem[] }[] = [];
    walk(items, (item, parent) => { if (matches(original.get(item) ?? item, rule.match)) entries.push({ item, parent }); });
    for (const { item, parent } of entries) {
      if (rule.hide === true) hidden.add(item);
      if (rule.hide === false) hidden.delete(item);
      if (rule.title !== undefined) item.label = rule.title;
      if (rule.icon !== undefined) item.icon = rule.icon;
      if (rule.group !== undefined) item.group = rule.group;
      if (rule.order !== undefined) orders.set(item, rule.order);
      if (!rule.move) continue;
      const move = rule.move;
      // Ambiguous IDs never select an arbitrary parent or anchor.
      const candidate = move.parent === null ? undefined : ids.get(move.parent);
      if (move.parent !== null && (candidate?.length !== 1 || !candidate[0].submenu)) continue;
      const destination = move.parent === null ? items : candidate![0].submenu!;
      let descendant = destination === item.submenu;
      if (item.submenu) walk(item.submenu, (child) => { if (child.submenu === destination) descendant = true; });
      if (descendant) continue;
      const anchorId = move.before ?? move.after;
      const anchors = anchorId === undefined ? [] : destination.filter((x) => x.id === anchorId);
      if (anchorId !== undefined && (anchors.length !== 1 || anchors[0] === item)) continue;
      parent.splice(parent.indexOf(item), 1);
      const position = anchorId !== undefined
        ? destination.indexOf(anchors[0]) + (move.after === undefined ? 0 : 1)
        : Math.min(move.index ?? destination.length, destination.length);
      destination.splice(position, 0, item);
    }
  }

  const clean = (list: ConfiguredMenuItem[]): ConfiguredMenuItem[] => {
    const visible = list.filter((item) => !hidden.has(item)).map((item) => {
      if (item.submenu) item.submenu = clean(item.submenu);
      return item;
    }).filter((item) => item.submenu === undefined || item.submenu.length > 0);
    // Preserve original separator groups. Explicit named groups can gather items
    // from several original sections; rank uses the first occurrence of a group.
    const rank = new Map<string, number>();
    const groups = new Map<string, { item: ConfiguredMenuItem; index: number }[]>();
    let originalGroup = 0;
    visible.forEach((item, i) => {
      if (item.separator) { originalGroup++; return; }
      const group = item.group !== undefined ? `named:${item.group}` : `original:${originalGroup}:${item.section ?? ''}`;
      if (!rank.has(group)) rank.set(group, rank.size);
      groups.set(group, [...(groups.get(group) ?? []), { item, index: i }]);
    });
    const result: ConfiguredMenuItem[] = [];
    for (const group of [...rank.keys()]) {
      const members = groups.get(group)!;
      members.sort((a, b) => (orders.get(a.item) ?? a.index) - (orders.get(b.item) ?? b.index) || a.index - b.index);
      if (result.length) result.push({ label: '', separator: true });
      result.push(...members.map((m) => m.item));
    }
    return result;
  };
  return attachMenuContext(clean(items), context);
}
