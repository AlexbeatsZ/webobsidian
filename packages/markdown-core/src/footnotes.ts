import { markdownComments, type MarkdownModel, type SourceSpan } from './syntax.js';
import { mathRegions } from './math.js';

export interface FootnoteDefinition extends SourceSpan { bodyFrom: number; markerTo: number }
export interface Footnote {
  id: string; number: number; inline: boolean;
  definitions: FootnoteDefinition[]; references: SourceSpan[];
  status: 'resolved' | 'missing' | 'ambiguous';
}
export interface Footnotes {
  notes: readonly Footnote[];
  references: ReadonlyMap<number, Footnote>;
  definitions: ReadonlyMap<number, Footnote>;
}
const cache = new WeakMap<MarkdownModel, Footnotes>();
export const footnoteFragment = (note: Footnote) => note.inline ? `[inline:${note.references[0].from}]` : `[^${note.id}]`;
export const footnoteReferenceFragment = (note: Footnote, occurrence: number) => `${footnoteFragment(note)}@${occurrence + 1}`;

/** Full-note identities and numbering, shared by views, fragments and navigation. */
export function footnotes(model: MarkdownModel): Footnotes {
  const cached = cache.get(model); if (cached) return cached;
  const excluded = [...model.literal, ...model.html, ...model.htmlBlocks, ...markdownComments(model), ...mathRegions(model),
    ...(model.frontmatter ? [model.frontmatter] : [])];
  const allowed = (span: SourceSpan) => !excluded.some(r => span.from < r.to && span.to > r.from);
  const byId = new Map<string, Footnote>(), references = new Map<number, Footnote>(), definitions = new Map<number, Footnote>();
  const markers = new Map<number, SourceSpan>();
  for (const node of model.nodes) if (node.name === 'FootnoteMark' && node.parent !== null) markers.set(node.parent, node);
  const get = (id: string, inline = false) => {
    let note = byId.get(id);
    if (!note) { note = { id, inline, number: 0, status: 'missing', definitions: [], references: [] }; byId.set(id, note); }
    return note;
  };
  for (let index = 0; index < model.nodes.length; index++) {
    const node = model.nodes[index];
    if (node.name !== 'FootnoteDefinition' || !allowed({ from: node.from, to: node.from + 2 })) continue;
    const marker = markers.get(index);
    if (!marker) continue;
    const id = model.text.slice(marker.from + 2, marker.to).split(']')[0];
    const note = get(id);
    const to = node.from + model.text.slice(node.from, node.to).trimEnd().length;
    note.definitions.push({ from: node.from, to, markerTo: marker.to, bodyFrom: marker.to });
    definitions.set(node.from, note);
  }
  let number = 0;
  for (const node of model.nodes) {
    if (!['FootnoteReference', 'InlineFootnote'].includes(node.name) || !allowed({ from: node.from, to: node.from + 2 })) continue;
    let parent = node.parent, nested = false;
    while (parent !== null) { if (model.nodes[parent].name === 'InlineFootnote') { nested = true; break; } parent = model.nodes[parent].parent; }
    if (nested) continue;
    const inline = node.name === 'InlineFootnote', id = inline ? '\0' + node.from : model.text.slice(node.from + 2, node.to - 1);
    const note = get(id, inline);
    if (!note.number) note.number = ++number;
    note.references.push({ from: node.from, to: node.to }); references.set(node.from, note);
    if (inline) note.definitions.push({ from: node.from, to: node.to, bodyFrom: node.from + 2, markerTo: node.from + 2 });
  }
  for (const note of byId.values()) note.status = note.definitions.length === 1 ? 'resolved' : note.definitions.length ? 'ambiguous' : 'missing';
  const notes = [...byId.values()].sort((a, b) => (a.number || Infinity) - (b.number || Infinity) || a.definitions[0].from - b.definitions[0].from);
  const value = { notes, references, definitions }; cache.set(model, value); return value;
}
