import { acquirePdfResource, type PdfResource } from './resource';
import { findPageMatches } from './text';
import type { PdfSnapshot } from './types';

export class PdfSession {
  private state: PdfSnapshot;
  private listeners = new Set<() => void>();
  private lifetime = new AbortController();
  private queryVersion = 0;
  private release?: () => void;
  resource?: PdfResource;
  readonly ready: Promise<void>;
  constructor(readonly path: string, readonly viewId = 'main') {
    this.state = { path, status: 'loading', pageCount: 0, currentPage: 1, navigation: 0, outline: [], outlineError: '',
      query: '', matches: [], matchesByPage: {}, activeMatch: -1, searchPending: false, searchedPages: 0, truncated: false, error: '' };
    this.ready = this.load();
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(update: Partial<PdfSnapshot>) {
    if (this.lifetime.signal.aborted) return;
    this.state = { ...this.state, ...update };
    for (const listener of this.listeners) listener();
  }
  private async load() {
    try {
      const acquired = await acquirePdfResource(this.path, this.lifetime.signal);
      if (this.lifetime.signal.aborted) { acquired.release(); return; }
      this.release = acquired.release; this.resource = acquired.resource;
      const document = await this.resource.ready;
      this.update({ status: 'ready', pageCount: document.numPages });
      void this.resource.outline().then(outline => this.update({ outline }), error => this.update({ outlineError: String(error) }));
    } catch (error) { this.update({ status: 'error', error: String(error) }); }
  }
  goToPage = (page: number) => {
    if (this.state.status !== 'ready' || !Number.isFinite(page)) return;
    this.update({ currentPage: Math.max(1, Math.min(this.state.pageCount, Math.round(page))), navigation: this.state.navigation + 1 });
  };
  observePage = (page: number) => {
    if (this.state.status === 'ready' && this.state.currentPage !== page) this.update({ currentPage: page });
  };
  setQuery = (query: string) => {
    const version = ++this.queryVersion;
    this.update({ query, matches: [], matchesByPage: {}, activeMatch: -1, searchPending: !!query.trim(), searchedPages: 0, truncated: false, error: '' });
    if (!query.trim()) return;
    void this.search(query, version);
  };
  private async search(query: string, version: number) {
    await this.ready;
    if (!this.resource || this.state.status !== 'ready') { this.update({ searchPending: false }); return; }
    const matches: PdfSnapshot['matches'][number][] = [];
    const matchesByPage: Record<number, PdfSnapshot['matches']> = {};
    try {
      for (let page = 1; page <= this.state.pageCount; page++) {
        if (version !== this.queryVersion || this.lifetime.signal.aborted) return;
        const text = await this.resource.text(page);
        if (version !== this.queryVersion || this.lifetime.signal.aborted) return;
        const found = findPageMatches(text, query, page);
        const remaining = 10000 - matches.length;
        const truncated = found.length > remaining;
        const accepted = found.slice(0, remaining);
        if (accepted.length) matchesByPage[page] = accepted;
        matches.push(...accepted);
        if (page === 1 || page % 8 === 0 || page === this.state.pageCount || truncated)
          this.update({ matches: [...matches], matchesByPage: { ...matchesByPage }, searchedPages: page,
            activeMatch: matches.length ? Math.max(0, this.state.activeMatch) : -1, truncated });
        if (truncated) break;
      }
      if (version === this.queryVersion) this.update({ searchPending: false });
    } catch (error) {
      if (version === this.queryVersion) this.update({ searchPending: false, error: `PDF 搜索失败：${String(error)}` });
    }
  }
  nextMatch = (direction: 1 | -1) => {
    const count = this.state.matches.length;
    if (!count) return;
    const activeMatch = (this.state.activeMatch + direction + count) % count;
    this.update({ activeMatch }); this.goToPage(this.state.matches[activeMatch].page);
  };
  destroy = () => {
    if (this.lifetime.signal.aborted) return;
    this.lifetime.abort(); this.queryVersion++; this.release?.(); this.resource = undefined;
    this.state = { ...this.state, status: 'destroyed' };
    for (const listener of this.listeners) listener();
    this.listeners.clear();
  };
}
