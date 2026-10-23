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
} from '@webobsidian/search-core';
import { api } from './api';
export { matchText, matchPath };
let entries: CatalogEntry[] = [],
  settings: SearchSettings = { ...searchDefaults };
let revision = 0,
  generation = 0;
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
export function useSearch() {
  useSyncExternalStore(subscribeSearch, () => revision);
  return { entries, settings };
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
  const [result, config] = await Promise.all([api.catalog(), api.getSettings()]);
  if (current !== generation) return;
  entries = result.entries;
  settings = { ...searchDefaults, ...config.search.chinese };
  changed();
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
export function fileCandidates(query: string, source = entries, recent: readonly string[] = []) {
  const filters = parseSearchQuery(query);
  const text = filters.filterText;
  return source
    .filter((e) => e.kind === 'file' && (settings.attachments || /\.(md|markdown)$/i.test(e.path)))
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
    })
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
