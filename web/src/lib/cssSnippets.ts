import { request } from './api';
import type { VaultConfigurationSource } from '../../../server/src/contracts';

export interface CssSnippets {
  source: VaultConfigurationSource; enabled: string[];
  snippets: { name: string; path: string; enabled: boolean; stamp: string }[];
}
export const readCssSnippets = () => request<CssSnippets>('/api/settings/css-snippets');
export const setCssSnippetEnabled = (source: VaultConfigurationSource, name: string, enabled: boolean) =>
  request<CssSnippets>('/api/settings/css-snippets', { method: 'PUT', body: JSON.stringify({ source, name, enabled }) });

/** Native appearance uses the same stylesheet elements and host lifetime as plugins. */
export function initializeCssSnippets(notify: (error: string) => void) {
  const links = new Map<string, HTMLLinkElement>();
  let stopped = false, generation = 0, vault = '', timer: ReturnType<typeof setTimeout> | undefined;
  const refresh = async () => {
    const current = ++generation;
    try {
      const state = await readCssSnippets();
      if (stopped || current !== generation) return;
      if (vault && state.source.vault !== vault) { for (const link of links.values()) link.remove(); links.clear(); }
      vault = state.source.vault;
      const names = state.enabled.filter(name => state.snippets.some(snippet => snippet.name === name));
      for (const [name, link] of links) if (!names.includes(name)) { link.remove(); links.delete(name); }
      for (const [index, name] of names.entries()) {
        const snippet = state.snippets.find(item => item.name === name)!;
        let link = links.get(name);
        if (!link) {
          link = document.createElement('link'); link.rel = 'stylesheet'; link.dataset.cssSnippet = name;
          link.onerror = () => { if (!stopped) notify(`CSS 片段加载失败：${name}`); };
          links.set(name, link);
        }
        const href = `/api/settings/css-snippets/${encodeURIComponent(snippet.path.split('/').at(-1)!)}?vault=${encodeURIComponent(vault)}&stamp=${encodeURIComponent(snippet.stamp)}`;
        if (link.getAttribute('href') !== href) link.href = href;
        const previous = index ? links.get(names[index - 1]) : undefined;
        if (!link.isConnected || (previous ? previous.nextElementSibling !== link : document.head.querySelector('[data-css-snippet]') !== link)) document.head.append(link);
      }
    } catch (error) { if (!stopped && current === generation) notify(String(error)); }
  };
  const changed = (event: Event) => {
    const path = (event as CustomEvent<{ path: string }>).detail?.path;
    if (path !== '.obsidian/appearance.json' && path !== '.obsidian/snippets' && !path?.startsWith('.obsidian/snippets/')) return;
    clearTimeout(timer); timer = setTimeout(() => void refresh(), 0);
  };
  const dispose = () => {
    stopped = true; generation++; clearTimeout(timer);
    window.removeEventListener('vault-configuration-changed', changed); window.removeEventListener('vault-changed', dispose);
    for (const link of links.values()) link.remove(); links.clear();
  };
  window.addEventListener('vault-configuration-changed', changed); window.addEventListener('vault-changed', dispose);
  void refresh();
  return dispose;
}
