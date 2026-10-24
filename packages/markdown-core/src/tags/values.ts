import { SourceDocument } from '../source.js';
import { readPropertyRows, canEditProperties } from '../properties.js';
import { normalizeStoredTags, tagPageAliases } from '@webobsidian/search-core/query';

/** Source-property helper for transient unsaved overlays, never a saved cache. */
export function readTagSourceNames(raw: string): string[] {
  const text = new SourceDocument(raw).text;
  const match = text.match(/^---\n([\s\S]*?)^---[ \t]*(?:\n|$)/m);
  if (!match || match.index !== 0 || !canEditProperties(match[1])) return [];
  return readPropertyRows(match[1]).flatMap((row) => /^tags?$/i.test(row.key) ? row.values.flatMap(normalizeStoredTags) :
    /^alias(?:es)?$/i.test(row.key) ? row.values.flatMap(tagPageAliases) : []);
}
