import type { MarkdownModel, SourceSpan } from './syntax.js';
import { extractMetadata } from './metadata.js';
import { legacySubheadings } from './legacySubheadings.js';
import { footnotes, footnoteFragment } from './footnotes.js';
import { contentTargets } from './contentTargets.js';

export interface FragmentRange extends SourceSpan {
  kind: 'document' | 'heading' | 'block' | 'equation' | 'footnote' | 'reference' | 'code' | 'callout' | 'range';
  /** The landing mark may be smaller than the section used for a preview/embed. */
  focus: SourceSpan;
}

export function fragmentRange(model: MarkdownModel, fragment: string): FragmentRange | null {
  const result = (range: SourceSpan, kind: FragmentRange['kind'], focus: SourceSpan = range): FragmentRange => ({ ...range, kind, focus });
  if (!fragment) return result({ from: 0, to: model.text.length }, 'document', { from: 0, to: 0 });
  const meta = extractMetadata(model);
  let decoded = fragment;
  try { decoded = decodeURIComponent(fragment); } catch { /* literal percent */ }
  const foot = /^(\[\^[^\]]+\]|\[inline:\d+\])(?:@(\d+))?$/.exec(decoded);
  if (foot) {
    const note = footnotes(model).notes.find(note => footnoteFragment(note) === foot[1]);
    if (!note) return null;
    if (foot[2]) { const reference = note.references[Number(foot[2]) - 1]; return reference ? result(reference, 'reference') : null; }
    if (note.status !== 'resolved') return null;
    const definition = note.definitions[0];
    return result(note.inline ? { from: definition.bodyFrom, to: definition.to - 1 } : definition, 'footnote', definition);
  }
  if (decoded.startsWith('^')) {
    if (/^\^(?:heading|eq|code|callout|range)-/.test(decoded)) {
      const target = contentTargets(model).targets.find(candidate => candidate.id === decoded.slice(1));
      return target ? result(target, target.kind, target.focus) : null;
    }
    const matches = meta.blockIds.filter(candidate => candidate.id === decoded.slice(1));
    if (matches.length !== 1) return null;
    const block = matches[0];
    if (!block) return null;
    const paragraph = model.nodes.filter((node) => ['Paragraph', 'ListItem', 'Blockquote'].includes(node.name) && node.from <= block.from && node.to >= block.to)
      .sort((a, b) => a.to - a.from - (b.to - b.from))[0];
    return result(paragraph ? { from: paragraph.from, to: paragraph.to } : { from: model.text.lastIndexOf('\n', block.from - 1) + 1, to: block.to }, 'block');
  }
  if (decoded.startsWith('-')) {
    const subheadings = legacySubheadings(model, meta.comments);
    const item = subheadings.find(candidate => candidate.fragment.normalize('NFC') === decoded.normalize('NFC'));
    if (item) {
      const next = [...subheadings, ...meta.headings].filter(candidate => candidate.from > item.from).sort((a, b) => a.from - b.from)[0];
      return result({ from: item.from, to: next?.from ?? model.text.length }, 'heading', { from: item.from, to: item.to });
    }
  }
  const normalize = (text: string) => text.replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim().normalize('NFC').toLocaleLowerCase();
  let candidates = meta.headings;
  let heading: typeof meta.headings[number] | undefined;
  const exact = candidates.find(candidate => normalize(candidate.text) === normalize(decoded));
  for (const part of exact ? [decoded] : decoded.split('#').filter(Boolean)) {
    heading = candidates.find(candidate => normalize(candidate.text) === normalize(part));
    if (!heading) return null;
    const end = meta.headings.find(candidate => candidate.from > heading!.from && candidate.level <= heading!.level)?.from ?? model.text.length;
    candidates = meta.headings.filter(candidate => candidate.from > heading!.from && candidate.from < end);
  }
  if (!heading) return null;
  const index = meta.headings.indexOf(heading);
  const next = meta.headings.slice(index + 1).find((candidate) => candidate.level <= heading.level);
  return result({ from: heading.from, to: next?.from ?? model.text.length }, 'heading', heading);
}
