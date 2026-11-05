import { useSyncExternalStore } from 'react';
import {
  matchText,
  matchPath,
  searchDefaults,
  type SearchSettings,
  type CatalogEntry,
  type TextMatch,
  parseSearchQuery,
  matchesTagFilters,
  emptyHotkeys,
  type VaultHotkeys,
  type Hotkey,
} from '@webobsidian/search-core';
import { api, request, type NoteMatches } from './api';
import { projectVirtualCatalog, isVirtualDocument, subscribeVirtualDocuments } from './virtualDocuments';
export { matchText, matchPath };
const resultListeners = new Set<() => void>();
let resultSnapshot: { query: string; matches: ReadonlyMap<string, NoteMatches> } = { query: '', matches: new Map() };
export const getSearchResultHighlights = () => resultSnapshot;
export function subscribeSearchResultHighlights(listener: () => void) {
  resultListeners.add(listener);
  return () => { resultListeners.delete(listener); };
}
export function publishSearchResultHighlights(query: string, matches: ReadonlyMap<string, NoteMatches>) {
  if (resultSnapshot.query === query && resultSnapshot.matches === matches) return;
  resultSnapshot = { query, matches };
  resultListeners.forEach(listener => listener());
}
let entries: CatalogEntry[] = [],
  settings: SearchSettings = { ...searchDefaults };
let revision = 0,
  generation = 0;
let hotkeys: VaultHotkeys = { ...emptyHotkeys(), vault: '' };
let hotkeyGeneration = 0, hotkeyError = '';
let pendingHotkeyCommand = '';
export function requestHotkeySettings(command = '') {
  pendingHotkeyCommand = command;
  window.dispatchEvent(new CustomEvent('hotkeys-settings-open', { detail: command }));
}
export function consumeHotkeySettingsRequest() { const command = pendingHotkeyCommand; pendingHotkeyCommand = ''; return command; }
export const peekHotkeySettingsRequest = () => pendingHotkeyCommand;
export const hotkeySettings = () => hotkeys;
const listeners = new Set<() => void>();
export const subscribeSearch = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
const changed = () => {
  revision++;
  listeners.forEach((fn) => fn());
};
subscribeVirtualDocuments(changed);
export function useSearch() {
  useSyncExternalStore(subscribeSearch, () => revision);
  return { entries, settings, hotkeys, hotkeyError };
}
export const searchSettings = () => settings;
export const searchEntries = () => entries;
let tagEntries: CatalogEntry[] | undefined, tagChoices: string[] = [];
/** Small derived completion list, invalidated by the existing catalog snapshot. */
export function searchTags(): string[] {
  if (tagEntries !== entries) {
    tagEntries = entries;
    tagChoices = [...new Set(entries.flatMap(entry => entry.tags.map(tag => tag.replace(/^#/, ''))))].sort();
  }
  return tagChoices;
}
export async function refreshSearch() {
  const current = ++generation;
  const keyGeneration = hotkeyGeneration;
  const [result, config, keys] = await Promise.allSettled([api.catalog(), api.getSettings(), request<VaultHotkeys>('/api/settings/hotkeys')]);
  if (current !== generation) return;
  if (result.status === 'fulfilled') entries = result.value.entries;
  else console.error(result.reason);
  if (config.status === 'fulfilled') settings = { ...searchDefaults, ...config.value.search.chinese };
  else console.error(config.reason);
  // A GET begun before or during a binding write must not replace that write.
  if (keyGeneration === hotkeyGeneration) {
    if (keys.status === 'fulfilled') { hotkeys = keys.value; hotkeyError = ''; }
    else hotkeyError = `快捷键载入失败，保留上次有效配置：${String(keys.reason)}`;
  }
  changed();
}
let hotkeyWrites: Promise<unknown> = Promise.resolve();
/** Server serializes patches; no optimistic reset or loss of another command's bindings. */
export function updateHotkeys(command: string, bindings: Hotkey[] | null) {
  const vault = hotkeys.vault;
  hotkeyGeneration++;
  const operation = hotkeyWrites.catch(() => {}).then(async () => {
    const next = await request<VaultHotkeys>('/api/settings/hotkeys', { method: 'PUT', body: JSON.stringify({ vault, command, bindings }) });
    if (hotkeys.vault !== vault) return;
    hotkeyGeneration++;
    hotkeys = next; hotkeyError = ''; changed();
  });
  hotkeyWrites = operation;
  return operation;
}
let writes: Promise<unknown> = Promise.resolve();
export function updateSearch(patch: Partial<SearchSettings>) {
  generation++;
  settings = { ...settings, ...patch };
  changed();
  writes = writes.catch(() => {}).then(() => api.putSettings({ search: { chinese: patch } }));
  return writes;
}
export function remember(kind: 'recentCommands', id: string) {
  void updateSearch({ [kind]: [id, ...settings[kind].filter((v) => v !== id)].slice(0, 50) }).catch(
    console.error,
  );
}
export function matchName(query: string, text: string): TextMatch | null {
  return matchText(query, text, settings);
}
// Typing usually extends the previous query, and every matcher used below is
// monotone (a match for "abc" is also a match for "ab"), so a longer query only
// needs to re-check the entries the cached shorter query already matched.
const narrowingLimit = 32;
let narrowing: { source: readonly CatalogEntry[]; settings: SearchSettings; key: string; results: Map<string, readonly CatalogEntry[]> } | undefined;
function narrowedSource(source: readonly CatalogEntry[], key: string, text: string): readonly CatalogEntry[] {
  if (!narrowing || narrowing.source !== source || narrowing.settings !== settings || narrowing.key !== key) {
    narrowing = { source, settings, key, results: new Map() };
    return source;
  }
  let best: readonly CatalogEntry[] = source, length = 0;
  for (const [prefix, matched] of narrowing.results)
    if (prefix.length > length && text.startsWith(prefix)) [best, length] = [matched, prefix.length];
  return best;
}
function rememberNarrowing(text: string, matched: readonly CatalogEntry[]) {
  if (!narrowing || !text) return;
  narrowing.results.delete(text);
  if (narrowing.results.size >= narrowingLimit) narrowing.results.delete(narrowing.results.keys().next().value!);
  narrowing.results.set(text, matched);
}
export function fileCandidates(query: string, source: readonly CatalogEntry[] = entries, recent: readonly string[] = []) {
  if (source === entries) source = projectVirtualCatalog(source);
  const filters = parseSearchQuery(query);
  const text = filters.filterText;
  const { filterText: _filterText, text: _text, ...rest } = filters;
  const pool = text ? narrowedSource(source, JSON.stringify(rest), text) : source;
  const found = pool
    .filter((e) => e.kind === 'file' && (settings.attachments || isVirtualDocument(e.path) || /\.(md|markdown)$/i.test(e.path)))
    .flatMap((entry) => {
      if (!matchesTagFilters(entry.tags, filters) || filters.fields.includes('body')) return [];
      const names = [
        ...new Set([
          entry.title,
          entry.path
            .split('/')
            .at(-1)!
            .replace(/\.(md|markdown)$/i, ''),
          ...entry.aliases,
        ]),
      ];
      const matches = (filters.fields.length && !filters.fields.includes('title') ? [] : names).flatMap((label) => {
        const match = matchName(text, label);
        return match ? [{ entry, label, match }] : [];
      });
      if ((!filters.fields.length && settings.usePath) || filters.fields.includes('path')) {
        const match = matchPath(text, entry.path, settings);
        if (match) matches.push({ entry, label: entry.title, match: { ...match, matches: [] } });
      }
      if (filters.fields.includes('headings')) for (const heading of entry.headings) {
        const match = matchName(text, heading);
        if (match) matches.push({ entry, label: entry.title, match: { ...match, matches: [] } });
      }
      matches.sort((a, b) => b.match.score - a.match.score);
      return matches.slice(0, 1);
    });
  if (text) rememberNarrowing(text, found.map((item) => item.entry));
  return found
    .sort((a, b) =>
      text
        ? b.match.score - a.match.score || a.entry.path.localeCompare(b.entry.path)
        : history(a.entry.path, recent) - history(b.entry.path, recent),
    );
}
function history(path: string, recent: readonly string[]) {
  const at = recent.indexOf(path);
  return at < 0 ? 1e9 : at;
}
