import { TargetIndex } from '@webobsidian/markdown-core';
import type { CatalogEntry } from '@webobsidian/search-core';
import type { ParsedNote } from './markdown.js';

export interface NoteRecord extends CatalogEntry {
  links: string[];
  properties: Record<string, string>;
  snippet: string;
}
export const CORE_LIST_PROPS = new Set(['tags', 'aliases', 'cssclasses']);
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
    this.putPath(path);
    const raw = note.frontmatter.aliases ?? note.frontmatter.alias;
    const aliases = (Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : []).filter(
      (v): v is string => typeof v === 'string',
    );
    const record: NoteRecord = {
      path,
      kind: 'file',
      title: note.title,
      aliases,
      tags: note.tags,
      headings: note.headings,
      links: note.links,
      properties: Object.fromEntries(
        Object.entries(note.frontmatter).map(([k, v]) => [k, propertyType(k, v)]),
      ),
      snippet: note.body.replace(/\s+/g, ' ').trim().slice(0, 280),
    };
    this.notes.set(path, record);
    this.entries.set(path, record);
  }
  remove(path: string) {
    this.targets.delete(path);
    this.entries.delete(path);
    this.notes.delete(path);
    this.stamps.delete(path);
  }
  resolve(target: string, source = '', scope: 'allFiles' | 'markdown' = 'allFiles') {
    return this.targets.resolve(
      target,
      source,
      scope === 'markdown' ? (p) => /\.(md|markdown)$/i.test(p) : undefined,
    );
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
    }
    for (const [path, stamp] of data.stamps) next.stamps.set(path, stamp);
    return next;
  }
}
export let catalog = new VaultCatalog();
export function replaceCatalog(next: VaultCatalog) {
  catalog = next;
}
