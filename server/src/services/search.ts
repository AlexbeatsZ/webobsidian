import { promises as fs } from 'node:fs';
import MiniSearch from 'minisearch';
import { getSettings } from './settings.js';
import { INDEX_FILE, config } from '../config.js';
import { getVaultRoot, readFileText } from './vaultFile.js';
import { catalog as activeCatalog, VaultCatalog, CORE_LIST_PROPS, CATALOG_SCHEMA_VERSION } from './catalog.js';
import { matchesTagFilters } from '@webobsidian/search-core';
import {
  findText,
  phoneticTokens,
  candidateTokens,
  MAX_BODY,
  SEARCH_VERSION,
  parseSearchQuery,
  type SearchOptions,
} from '@webobsidian/search-core';
import { parseNote, type ParsedNote } from './markdown.js';
import { SourceDocument } from '@webobsidian/markdown-core';
import type { SearchHit, MatchContext, NoteMatches } from '../contracts.js';
export type { SearchHit, MatchContext, NoteMatches } from '../contracts.js';

/**
 * QMD — the WebObsidian search engine.
 * A thin, opinionated layer over MiniSearch giving fielded, fuzzy, prefix and
 * boolean queries over the vault's markdown, with incremental updates and a
 * persisted on-disk index for fast cold starts. (PRD FR-7)
 */

interface QmdDoc {
  id: string; // vault-relative path
  title: string;
  headings: string;
  tags: string;
  path: string;
  body: string;
  [field: string]: string;
}

const FIELDS = ['title', 'headings', 'tags', 'path', 'body'] as const;

/** Re-base highlight ranges after `text.trim()` drops leading whitespace. */
function shiftRanges(untrimmed: string, ranges: [number, number][]): [number, number][] {
  const lead = untrimmed.length - untrimmed.replace(/^\s+/, '').length;
  const trimmedLen = untrimmed.trim().length;
  return ranges
    .map(([s, l]) => [Math.max(0, s - lead), l] as [number, number])
    .filter(([s]) => s < trimmedLen);
}

export class QmdEngine {
  private mini: MiniSearch<QmdDoc>;
  private ready = false;
  constructor(readonly catalog: VaultCatalog = activeCatalog) {
    this.mini = this.newIndex();
  }
  private indexOptions() {
    return {
      fields: [...FIELDS, ...FIELDS.map((f) => 'py_' + f)],
      storeFields: [],
      autoVacuum: false,
      tokenize: (text: string, field?: string) =>
        field?.startsWith('py_') ? text.split(' ') : MiniSearch.getDefault('tokenize')(text),
    };
  }
  private newIndex() {
    return new MiniSearch<QmdDoc>(this.indexOptions());
  }

  private fromNote(rel: string, note: ParsedNote): QmdDoc {
    const doc: QmdDoc = {
      id: rel,
      title: note.title,
      headings: note.headings.join(' '),
      tags: note.tags.join(' '),
      path: rel,
      body: note.body.slice(0, MAX_BODY),
    };
    for (const field of FIELDS) doc['py_' + field] = phoneticTokens(doc[field]).join(' ');
    return doc;
  }
  async build(): Promise<void> {
    const { rebuildVaultIndex } = await import('./vaultindex.js');
    await rebuildVaultIndex();
  }
  finish() {
    this.ready = true;
  }

  async upsert(rel: string): Promise<void> {
    if (!/\.(md|markdown)$/i.test(rel)) return;
    try {
      this.upsertNote(rel, parseNote(rel, await readFileText(rel)));
    } catch {
      this.remove(rel);
    }
  }

  upsertNote(rel: string, note: ParsedNote): void {
    const doc = this.fromNote(rel, note);
    if (this.mini.has(rel)) this.mini.replace(doc);
    else this.mini.add(doc);
    this.catalog.putNote(rel, note);
  }

  remove(rel: string): void {
    if (this.mini.has(rel)) this.mini.discard(rel);
    this.catalog.remove(rel);
  }

  async rename(from: string, to: string): Promise<void> {
    this.remove(from);
    await this.upsert(to);
  }

  /** `limit <= 0` returns every match (caller renders incrementally). */
  async search(query: string, limit = 0, mode: 'literal' | 'pinyin' = 'literal'): Promise<SearchHit[]> {
    if (!this.ready) {
      const { rebuildVaultIndex } = await import('./vaultindex.js');
      await rebuildVaultIndex();
      return qmd.search(query, limit, mode);
    }
    const s = await getSettings();
    const tagFilters = parseSearchQuery(query);
    const { filterText, fields } = tagFilters;
    const q = filterText.trim();
    const selected = fields.length ? fields : [...FIELDS];
    const results = q
      ? this.mini.search(q, {
          fields: selected,
          prefix: s.search.prefix,
          fuzzy: s.search.fuzzy,
          boost: { title: 4, headings: 2, tags: 3 },
        })
      : [];
    const hits = new Map<string, SearchHit>();
    if (!q && (tagFilters.include.length || tagFilters.exclude.length))
      for (const record of this.catalog.notes.values()) {
        if (!matchesTagFilters(record.tags, tagFilters)) continue;
        hits.set(record.path, { path: record.path, title: record.title, score: 1,
          tags: record.tags, snippet: record.snippet, matchedField: 'tags', matchKind: 'literal' });
      }
    for (const result of results) {
      const record = this.catalog.notes.get(result.id);
      if (!record || !matchesTagFilters(record.tags, tagFilters)) continue;
      hits.set(record.path, {
        path: record.path,
        title: record.title,
        score: result.score,
        tags: record.tags,
        snippet: record.snippet,
        matchKind: 'literal',
      });
    }
    const options = s.search.chinese;
    if (mode === 'pinyin' && options.enabled && /[a-z]{2}|[a-z].*[a-z]/i.test(q)) {
      const tokens = options.fuzzyRules.length ? ['han'] : candidateTokens(q);
      const candidates = this.mini.search(tokens.join(' '), {
        fields: selected.map((f) => 'py_' + f),
        tokenize: (t) => t.split(' '),
        processTerm: (t) => t,
        prefix: false,
        fuzzy: false,
        combineWith: 'AND',
      });
      // Only candidate documents are read, in bounded batches. Verify source rather than trusting gram co-occurrence.
      for (let at = 0; at < candidates.length; at += 4)
        await Promise.all(
          candidates.slice(at, at + 4).map(async (candidate) => {
            if (hits.has(candidate.id)) return;
            const record = this.catalog.notes.get(candidate.id);
            if (!record || !matchesTagFilters(record.tags, tagFilters)) return;
            const values: Record<string, string> = {
              title: record.title,
              headings: record.headings.join(' '),
              tags: record.tags.join(' '),
              path: record.path,
            };
            for (const field of selected) {
              if (field === 'body') {
                try {
                  values.body = parseNote(record.path, await readFileText(record.path)).body.slice(
                    0,
                    MAX_BODY,
                  );
                } catch {
                  continue;
                }
              }
              const match = findText(q, values[field] ?? '', options, true)[0];
              if (!match) continue;
              const [start, end] = match.matches[0];
              hits.set(record.path, {
                path: record.path,
                title: record.title,
                score: 0.1,
                tags: record.tags,
                snippet: (values[field] ?? '').slice(Math.max(0, start - 32), end + 32),
                matchedField: field,
                matchKind: match.kind,
              });
              break;
            }
          }),
        );
    }
    const ordered = [...hits.values()].sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
    return limit > 0 ? ordered.slice(0, limit) : ordered;
  }

  /** Free-text terms from a query (operators like `tag:`/`path:` stripped),
   *  used to scan note bodies for highlightable occurrences. */
  queryText(query: string): string {
    return parseSearchQuery(query).filterText;
  }
  queryTerms(query: string): string[] {
    return this.queryText(query)
      .split(/\s+/)
      .map((t) => t.replace(/^["']|["']$/g, '').trim())
      .filter((t) => t.length >= 2);
  }

  /** Read a note's body and extract every occurrence of `terms`, grouped into
   *  context windows (Obsidian-style per-note match list). Reads from disk so
   *  it's called lazily for the notes actually rendered. */
  async matchesFor(
    rel: string,
    terms: string[],
    opts: {
      caseSensitive?: boolean;
      maxContexts?: number;
      pinyin?: SearchOptions;
      pinyinQuery?: string;
    } = {},
  ): Promise<NoteMatches> {
    const needles = terms.map((t) => (opts.caseSensitive ? t : t.toLowerCase())).filter(Boolean);
    if (!needles.length && !opts.pinyinQuery) return { path: rel, count: 0, contexts: [] };

    let body = '', bodyFrom = 0;
    try {
      const source = new SourceDocument(await readFileText(rel)).text;
      body = parseNote(rel, source).body;
      bodyFrom = source.endsWith(body) ? source.length - body.length : 0;
      if (opts.pinyin) body = body.slice(0, MAX_BODY);
    } catch {
      return { path: rel, count: 0, contexts: [] };
    }
    const hay = opts.caseSensitive ? body : body.toLowerCase();

    // Collect every occurrence, then drop overlaps (greedy left-to-right).
    const raw: { start: number; len: number }[] = [];
    for (const n of needles) {
      for (let i = hay.indexOf(n); i !== -1; i = hay.indexOf(n, i + n.length)) {
        raw.push({ start: i, len: n.length });
      }
    }
    if (opts.pinyin && /[a-z].*[a-z]/i.test(opts.pinyinQuery ?? terms.join(''))) {
      for (const match of findText(opts.pinyinQuery ?? terms.join(''), body, {
        ...opts.pinyin,
        caseSensitive: opts.caseSensitive,
      }))
        for (const [start, end] of match.matches) raw.push({ start, len: end - start });
    }
    if (!raw.length) return { path: rel, count: 0, contexts: [] };
    raw.sort((a, b) => a.start - b.start || b.len - a.len);
    const occ: { start: number; len: number }[] = [];
    let lastEnd = -1;
    for (const o of raw) {
      if (o.start >= lastEnd) {
        occ.push(o);
        lastEnd = o.start + o.len;
      }
    }

    const PAD = 32; // chars of context on each side
    const MERGE_GAP = 64; // merge occurrences closer than this into one window
    const MAX = opts.maxContexts ?? 20;
    const contexts: MatchContext[] = [];
    let group: { start: number; len: number }[] = [];

    const flush = () => {
      if (!group.length || contexts.length >= MAX) {
        group = [];
        return;
      }
      const winStart = Math.max(0, group[0].start - PAD);
      const lastOcc = group[group.length - 1];
      const winEnd = Math.min(body.length, lastOcc.start + lastOcc.len + PAD);
      // length-preserving newline/tab → space so range offsets stay valid
      const text = body.slice(winStart, winEnd).replace(/[\n\r\t]/g, ' ');
      const ranges = group.map((o) => [o.start - winStart, o.len] as [number, number]);
      contexts.push({
        text: text.trim(),
        source: { from: bodyFrom + group[0].start, to: bodyFrom + group[0].start + group[0].len,
          text: body.slice(group[0].start, group[0].start + group[0].len) },
        ranges: shiftRanges(text, ranges),
        pre: winStart > 0,
        post: winEnd < body.length,
      });
      group = [];
    };

    for (const o of occ) {
      if (
        group.length &&
        o.start - (group[group.length - 1].start + group[group.length - 1].len) > MERGE_GAP
      ) {
        flush();
      }
      group.push(o);
    }
    flush();

    return { path: rel, count: occ.length, contexts,
      sourceRanges: occ.map(match => ({ from: bodyFrom + match.start, to: bodyFrom + match.start + match.len,
        text: body.slice(match.start, match.start + match.len) })) };
  }

  allTags(): { tag: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const { tags } of this.catalog.notes.values()) {
      for (const t of tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count);
  }

  /** Vault-wide frontmatter property keys (for the property-name suggester). */
  allProperties(): { key: string; type: string; count: number }[] {
    const count = new Map<string, number>();
    const types = new Map<string, Map<string, number>>();
    // Always offer Obsidian's built-in List properties, even if unused yet.
    for (const k of CORE_LIST_PROPS) {
      count.set(k, 0);
      types.set(k, new Map([['list', 1]]));
    }
    for (const { properties: meta } of this.catalog.notes.values()) {
      for (const [k, t] of Object.entries(meta)) {
        count.set(k, (count.get(k) ?? 0) + 1);
        const tm = types.get(k) ?? new Map<string, number>();
        tm.set(t, (tm.get(t) ?? 0) + 1);
        types.set(k, tm);
      }
    }
    return [...count.entries()]
      .map(([key, c]) => {
        let best = 'text';
        let bn = 0;
        for (const [t, n] of types.get(key) ?? [])
          if (n > bn) {
            bn = n;
            best = t;
          }
        return { key, type: best, count: c };
      })
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  }

  async save(): Promise<void> {
    try {
      await fs.mkdir(config.dataDir, { recursive: true });
      const payload = {
        version: SEARCH_VERSION,
        catalogSchema: CATALOG_SCHEMA_VERSION,
        root: await getVaultRoot(),
        mini: this.mini.toJSON(),
        catalog: this.catalog.serialize(),
      };
      const tmp = INDEX_FILE + '.tmp';
      await fs.writeFile(tmp, JSON.stringify(payload));
      await fs.rename(tmp, INDEX_FILE);
    } catch {
      /* disposable cache */
    }
  }
  restoreMini(json: unknown) {
    this.mini = MiniSearch.loadJSON<QmdDoc>(JSON.stringify(json), this.indexOptions());
    this.ready = true;
  }
}

export let qmd = new QmdEngine();
export function replaceSearch(next: QmdEngine) {
  qmd = next;
}

/** Initialize the engine: restore from disk or build fresh. */
export async function initSearch(): Promise<void> {
  const { rebuildVaultIndex } = await import('./vaultindex.js');
  await rebuildVaultIndex(true);
}
