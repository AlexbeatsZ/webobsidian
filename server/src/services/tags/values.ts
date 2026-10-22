import { SourceDocument, readPropertyRows, canEditProperties } from '@webobsidian/markdown-core';
import { normalizeStoredTags, tagPageAliases } from './query.js';

/** Source-property helper for transient unsaved overlays, never a saved cache. */
export function readTagSourceNames(raw: string): string[] {
  const text = new SourceDocument(raw).text;
  const match = text.match(/^---\n([\s\S]*?)^---[ \t]*(?:\n|$)/m);
  if (!match || match.index !== 0 || !canEditProperties(match[1])) return [];
  return readPropertyRows(match[1]).flatMap((row) => /^tags?$/i.test(row.key) ? row.values.flatMap(normalizeStoredTags) :
    /^alias(?:es)?$/i.test(row.key) ? row.values.flatMap(tagPageAliases) : []);
}
