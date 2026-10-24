import { useSyncExternalStore } from 'react';
import { useStore, type ContextMenuItem } from '../store';
import { tagsApi, assertTagVaultCurrent } from './api';
import { searchEntries } from '../search';
import { withTagFilter, tagKey, tagName, tagPageAliases } from '@webobsidian/search-core';
import type { TagOperation, TagScope } from '@webobsidian/markdown-core';

export interface TagOperationRequest { scope: TagScope; operation?: TagOperation; title?: string }
export type TagDialogRequest = { kind: 'operation'; value: TagOperationRequest } |
  { kind: 'page'; tag: string; pages: string[]; suggestedPath: string; content: string; toSide: boolean };
let request: TagDialogRequest | null = null;
export interface TagHoverRequest { path: string; x: number; y: number }
let hover: TagHoverRequest | null = null;
const listeners = new Set<() => void>();
function changed() { for (const listener of listeners) listener(); }
function setRequest(next: TagDialogRequest | null) { request = next; hover = null; changed(); }
export const closeTagDialog = () => setRequest(null);
export function useTagDialogRequest() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => request);
}
export function useNativeTagHover() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => hover);
}
// A derived lookup belongs to the existing frontend catalog snapshot: changing
// its array identity drops the map. No saved metadata, body cache or watcher.
let pageEntries: ReturnType<typeof searchEntries> | undefined;
let pageLookup = new Map<string, string[]>();
export function nativeTagPages(tag: string): readonly string[] {
  const entries = searchEntries();
  if (entries !== pageEntries) {
    const next = new Map<string, Set<string>>();
    for (const entry of entries) if (/\.(md|markdown)$/i.test(entry.path))
      for (const alias of entry.aliases) for (const name of tagPageAliases(alias)) {
        const key = tagKey(name), paths = next.get(key) ?? new Set<string>(); paths.add(entry.path); next.set(key, paths);
      }
    pageEntries = entries; pageLookup = new Map([...next].map(([key, paths]) => [key, [...paths].sort()]));
  }
  return pageLookup.get(tagKey(tag)) ?? [];
}
export function showNativeTagHover(tag: string, position: { clientX: number; clientY: number }) {
  if (request) return;
  const pages = nativeTagPages(tag);
  hover = pages.length === 1 ? { path: pages[0], x: position.clientX, y: position.clientY } : null;
  changed();
}
export function hideNativeTagHover() { if (hover) { hover = null; changed(); } }
export function openTagOperation(value: TagOperationRequest) { setRequest({ kind: 'operation', value }); }
export function renameNativeTag(tag: string, destination = tag) {
  openTagOperation({ scope: { kind: 'vault' }, operation: { kind: 'rename', from: tagName(tag), to: tagName(destination) }, title: '重命名标签层级' });
}
export function deleteNativeTag(tag = '') {
  openTagOperation({ scope: { kind: 'vault' }, operation: { kind: 'remove', tags: tag ? [tagName(tag)] : [], descendants: true }, title: '删除标签' });
}
export function searchNativeTag(tag: string, mode: 'new' | 'include' | 'exclude' = 'new') {
  const state = useStore.getState();
  state.searchFor(withTagFilter(state.searchQuery, tag, mode));
}
export async function openNativeTagPage(tag: string, toSide = false, allowCreate = true) {
  try {
    assertTagVaultCurrent();
    const page = await tagsApi.page(tag);
    assertTagVaultCurrent();
    if (page.pages.length === 1) {
      const state = useStore.getState();
      await (toSide ? state.openToSide(page.pages[0]) : state.openFile(page.pages[0]));
      return;
    }
    if (!page.pages.length && !allowCreate) { useStore.getState().notify('此标签没有已保存的标签页'); return; }
    setRequest({ kind: 'page', tag: tagName(tag), ...page, toSide });
  } catch (error) { useStore.getState().notify(String(error)); }
}

/** Stable menu action/context IDs consumed by the existing menu renderer/config. */
export const TAG_MENU_CONTEXT = 'tag-menu';
export type NativeTagMenuItem = ContextMenuItem & { id: string; section: string; disabled?: boolean };
export interface TagMenuOptions {
  tag: string; hasPage?: boolean; wranglerEnabled?: boolean; batchEnabled?: boolean;
  collapseSiblings?: () => void; expandSiblings?: () => void;
  readonly?: boolean; source?: 'tags-panel' | 'editor' | 'reading' | 'property';
}
export function nativeTagMenuItems(options: TagMenuOptions): NativeTagMenuItem[] {
  const { tag } = options;
  const items: NativeTagMenuItem[] = [];
  const hasPage = options.hasPage ?? nativeTagPages(tag).length > 0;
  if (options.wranglerEnabled !== false) {
    if (!options.readonly) items.push({ id: 'tags.rename', section: 'tag-rename', label: `重命名 #${tagName(tag)}`, icon: 'pencil', onClick: () => renameNativeTag(tag) });
    if (!options.readonly || hasPage) items.push({ id: 'tags.page', section: 'tag-page', label: hasPage ? '打开标签页' : '创建标签页', icon: 'file', onClick: () => { void openNativeTagPage(tag, false, !options.readonly); } });
  }
  if (!options.readonly && options.batchEnabled !== false) items.push({ id: 'tags.delete', section: 'tag-delete', label: `删除 #${tagName(tag)}…`, icon: 'trash', danger: true, onClick: () => deleteNativeTag(tag) });
  items.push(
    { id: 'tags.search.new', section: 'tag-search', label: `搜索 #${tagName(tag)}`, icon: 'search', onClick: () => searchNativeTag(tag) },
    { id: 'tags.search.include', section: 'tag-search', label: '在当前搜索中包含此标签', onClick: () => searchNativeTag(tag, 'include') },
    { id: 'tags.search.exclude', section: 'tag-search', label: '在当前搜索中排除此标签', onClick: () => searchNativeTag(tag, 'exclude') },
  );
  if (options.collapseSiblings) items.push({ id: 'tags.siblings.collapse', section: 'tag-tree', label: '折叠同级标签', onClick: options.collapseSiblings });
  if (options.expandSiblings) items.push({ id: 'tags.siblings.expand', section: 'tag-tree', label: '展开同级标签', onClick: options.expandSiblings });
  return items;
}
export function nativeBatchTagMenuItems(scope: TagScope): NativeTagMenuItem[] {
  return [{ id: 'tags.batch', section: 'tags', label: '批量添加 / 移除 / 替换标签…', icon: 'hash',
    onClick: () => openTagOperation({ scope }) }];
}
export function openNativeTagMenu(event: { clientX: number; clientY: number; preventDefault(): void }, options: TagMenuOptions) {
  hideNativeTagHover();
  event.preventDefault();
  const menu = { x: event.clientX, y: event.clientY, items: nativeTagMenuItems(options),
    context: { kind: TAG_MENU_CONTEXT, tag: options.tag, source: options.source ?? 'tags-panel' } };
  useStore.getState().openContextMenu(menu);
}
export function dropTagDestination(source: string, target: string): string | null {
  if (tagKey(source) === tagKey(target) || tagKey(target).startsWith(tagKey(source) + '/')) return null;
  return tagName(target) + '/' + tagName(source).split('/').at(-1)!;
}
