import type { MarkdownModel, SourceSpan } from './syntax.js';
import { extractMetadata } from './metadata.js';
import type { FragmentRange } from './fragments.js';

export interface LegacySubheading extends SourceSpan { text: string; fragment: string }
const cache = new WeakMap<MarkdownModel, LegacySubheading[]>();
/** Existing Interactive JS subheadings, derived from the authoritative model. */
export function legacySubheadings(model: MarkdownModel, comments: readonly SourceSpan[]): LegacySubheading[] {
  const prior = cache.get(model); if (prior) return prior;
  const excluded = [...model.literal, ...model.htmlBlocks, ...comments, ...(model.frontmatter ? [model.frontmatter] : [])];
  const counts = new Map<string, number>(), result: LegacySubheading[] = [];
  for (const match of model.text.matchAll(/^>[\t ]*\*\*(.+?)\*\*(?:[\t ]+\^(subheading-[a-f0-9]{6}))?[\t ]*$/gm)) {
    const from = match.index!, to = from + match[0].length;
    if (excluded.some(span => from < span.to && to > span.from)) continue;
    const text = match[1].trim(), occurrence = counts.get(text) ?? 0;
    counts.set(text, occurrence + 1);
    result.push({ from, to, text, fragment: '-' + text + (occurrence ? ' ' + occurrence : '') });
  }
  cache.set(model, result); return result;
}

/** Retained for explicit migration of pre-native Interactive JS headings. */
export function legacySubheadingRange(model: MarkdownModel, fragment: string): FragmentRange | null {
  let decoded = fragment;
  try { decoded = decodeURIComponent(fragment); } catch { /* literal percent */ }
  if (!decoded.startsWith('-')) return null;
  const metadata = extractMetadata(model), headings = legacySubheadings(model, metadata.comments);
  const item = headings.find(candidate => candidate.fragment.normalize('NFC') === decoded.normalize('NFC'));
  if (!item) return null;
  const next = [...headings, ...metadata.headings].filter(candidate => candidate.from > item.from).sort((a, b) => a.from - b.from)[0];
  return { from: item.from, to: next?.from ?? model.text.length, kind: 'heading', focus: { from: item.from, to: item.to } };
}
