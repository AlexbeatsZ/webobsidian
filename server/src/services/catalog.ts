import { TargetIndex, isGlobalContentTarget, parseLinkTarget, type ResolvedTarget } from '@webobsidian/markdown-core';
import type { CatalogEntry } from '@webobsidian/search-core';
import type { ParsedNote } from './markdown.js';

export interface NoteRecord extends CatalogEntry {
  links: string[];
  properties: Record<string, string>;
  snippet: string;
  contentTargets: ParsedNote['contentTargets'];
}
export const CORE_LIST_PROPS = new Set(['tags', 'aliases', 'cssclasses']);
/** Metadata normalization is part of persisted cache compatibility. */
export const CATALOG_SCHEMA_VERSION = 4;
function propertyType(key: string, value: unknown): string {
  if (CORE_LIST_PROPS.has(key) || Array.isArray(value)) return 'list';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'checkbox';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) return 'datetime';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return 'date';
  return 'text';
}
export class VaultCatalog {
  readonly targets = new TargetIndex();
  readonly entries = new Map<string, CatalogEntry>();
  readonly notes = new Map<string, NoteRecord>();
  readonly stamps = new Map<string, string>();
  private readonly contentPaths = new Map<string, Set<string>>();
  private removeContentTargets(path: string) {
    for (const id of this.contentIdsFor(path)) {
      const paths = this.contentPaths.get(id);
      paths?.delete(path);
      if (!paths?.size) this.contentPaths.delete(id);
    }
  }
  contentIdsFor(path: string): string[] {
    const metadata = this.notes.get(path)?.contentTargets;
    return [...new Set([...(metadata?.targets ?? []).map(target => target.id), ...(metadata?.issues ?? []).map(issue => issue.id)])];
  }
  dependencyKeysFor(path: string): string[] {
    return [...this.targets.keysFor(path), ...this.contentIdsFor(path).map(id => `content:${id}`)];
  }
  dependencies(raw: string, source: string): string[] {
    return isGlobalContentTarget(raw)
      ? [`content:${parseLinkTarget(raw).fragment.slice(1)}`]
      : this.targets.dependencies(raw, source);
  }
  putPath(path: string, folder = false, stamp?: string) {
    if (!folder) this.targets.add(path);
    else this.targets.delete(path);
    if (!this.entries.has(path) || this.entries.get(path)!.kind !== (folder ? 'folder' : 'file'))
      this.entries.set(path, {
        path,
        kind: folder ? 'folder' : 'file',
        title: path
          .split('/')
          .at(-1)!
          .replace(/\.(md|markdown)$/i, ''),
        aliases: [],
        tags: [],
        headings: [],
      });
    if (stamp) this.stamps.set(path, stamp);
  }
  putNote(path: string, note: ParsedNote) {
    this.removeContentTargets(path);
    this.putPath(path);
    const aliases = [...new Set(Object.entries(note.frontmatter)
      .filter(([key]) => /^aliases?$/i.test(key))
      .flatMap(([, raw]) => Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [])
      .filter((value): value is string => typeof value === 'string'))];
    const record: NoteRecord = {
      path,
      kind: 'file',
      title: note.title,
      aliases,
      tags: note.tags,
      headings: note.headings,
      links: note.links,
      contentTargets: note.contentTargets,
      properties: Object.fromEntries(
        Object.entries(note.frontmatter).map(([k, v]) => [k, propertyType(k, v)]),
      ),
      snippet: note.body.replace(/\s+/g, ' ').trim().slice(0, 280),
    };
    this.notes.set(path, record);
    this.entries.set(path, record);
    for (const id of this.contentIdsFor(path)) {
      if (!this.contentPaths.has(id)) this.contentPaths.set(id, new Set());
      this.contentPaths.get(id)!.add(path);
    }
  }
  remove(path: string) {
    this.removeContentTargets(path);
    this.targets.delete(path);
    this.entries.delete(path);
    this.notes.delete(path);
    this.stamps.delete(path);
  }
  resolve(target: string, source = '', scope: 'allFiles' | 'markdown' = 'allFiles'): ResolvedTarget & { targetOccurrences?: { path: string; valid: boolean }[] } {
    if (isGlobalContentTarget(target)) {
      const parsed = parseLinkTarget(target);
      const id = parsed.fragment.slice(1);
      const candidates = [...(this.contentPaths.get(id) ?? [])].sort();
      const targetOccurrences = candidates.flatMap(path => {
        const metadata = this.notes.get(path)!.contentTargets;
        const invalid = metadata.issues.some(issue => issue.id === id);
        return [
          ...metadata.targets.filter(entry => entry.id === id).map(() => ({ path, valid: !invalid })),
          ...metadata.issues.filter(issue => issue.id === id).map(() => ({ path, valid: false })),
        ];
      });
      const metadata = candidates.length === 1 ? this.notes.get(candidates[0])?.contentTargets : undefined;
      const unique = metadata?.targets.filter(entry => entry.id === id).length === 1 &&
        !metadata.issues.some(issue => issue.id === id);
      const status = !candidates.length ? 'missing' : candidates.length === 1 && unique ? 'resolved' : 'ambiguous';
      return { ...parsed, path: status === 'resolved' ? candidates[0] : '', status, candidates, targetOccurrences };
    }
    return this.targets.resolve(
      target,
      source,
      scope === 'markdown' ? (p) => /\.(md|markdown)$/i.test(p) : undefined,
    );
  }
  suggestContentTargets(query = '', limit = 50, sourceFile?: string) {
    const needle = query.trim().replace(/^\^/, '').toLocaleLowerCase();
    const bound = Number.isFinite(limit) ? Math.min(100, Math.max(1, Math.floor(limit))) : 50;
    const results: { id: string; kind: ParsedNote['contentTargets']['targets'][number]['kind']; label: string; path: string }[] = [];
    for (const [path, note] of this.notes) {
      if (sourceFile !== undefined && path !== sourceFile) continue;
      const seen = new Set<string>();
      for (const target of note.contentTargets.targets) {
        if (seen.has(target.id)) continue;
        seen.add(target.id);
        if (needle && !`${target.id}\n${target.label}\n${path}`.toLocaleLowerCase().includes(needle)) continue;
        if (this.resolve(`^${target.id}`).status !== 'resolved') continue;
        results.push({ id: target.id, kind: target.kind, label: target.label, path });
        if (results.length >= bound) return results;
      }
    }
    return results;
  }
  serialize() {
    return { entries: [...this.entries], notes: [...this.notes], stamps: [...this.stamps] };
  }
  static restore(data: ReturnType<VaultCatalog['serialize']>) {
    const next = new VaultCatalog();
    for (const [path, entry] of data.entries) {
      next.putPath(path, entry.kind === 'folder');
      next.entries.set(path, entry);
    }
    for (const [path, note] of data.notes) {
      next.notes.set(path, note);
      next.entries.set(path, note);
      for (const id of next.contentIdsFor(path)) {
        if (!next.contentPaths.has(id)) next.contentPaths.set(id, new Set());
        next.contentPaths.get(id)!.add(path);
      }
    }
    for (const [path, stamp] of data.stamps) next.stamps.set(path, stamp);
    return next;
  }
}
export let catalog = new VaultCatalog();
export function replaceCatalog(next: VaultCatalog) {
  catalog = next;
}
