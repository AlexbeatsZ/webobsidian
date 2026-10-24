import { StateField, type EditorState, type Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { caretTouches, mathRegions, type SourceSpan, type MarkdownModel, type Metadata } from '@webobsidian/markdown-core';
import { syntaxModel, documentMetadata } from './syntaxModel';
import { livePreviewState, livePreviewReadonly } from './renderState';
import { compositionSelection } from './inlineHtml';
import { sourceIsOpen } from './sourceControls';
import { followRenderedLink } from './fragmentNavigation';
import { decorationInputsChanged } from './decorationDependencies';
import { overlapIndex } from './rangeIndex';
import { blockEffectOwns } from './blocks/model';

class ReferenceLink extends WidgetType {
  constructor(readonly label: string, readonly target: string) { super(); }
  eq(other: ReferenceLink) { return other.label === this.label && other.target === this.target; }
  toDOM(view: EditorView) {
    const anchor = document.createElement('a');
    anchor.className = 'cm-md-link'; anchor.textContent = this.label; anchor.title = this.target;
    anchor.addEventListener('mousedown', (event) => {
      event.preventDefault(); event.stopPropagation();
      followRenderedLink(view, this.target);
    });
    return anchor;
  }
  ignoreEvent() { return true; }
}
class FootnoteReference extends WidgetType {
  constructor(readonly number: number, readonly definition: number, readonly label: string) { super(); }
  eq(other: FootnoteReference) { return other.number === this.number && other.definition === this.definition && other.label === this.label; }
  toDOM(view: EditorView) {
    const anchor = document.createElement('a');
    anchor.className = 'cm-footref cm-footnote-reference'; anchor.textContent = String(this.number); anchor.title = this.label;
    anchor.addEventListener('mousedown', (event) => {
      event.preventDefault(); event.stopPropagation();
      if (this.definition >= 0) view.dispatch({ selection: { anchor: this.definition }, scrollIntoView: true });
    });
    return anchor;
  }
  ignoreEvent() { return true; }
}

type SemanticItem = { span: SourceSpan; decoration: Decoration };
const cache = new WeakMap<MarkdownModel, SemanticItem[]>();
function items(model: MarkdownModel, meta: Metadata): SemanticItem[] {
  const cached = cache.get(model);
  if (cached) return cached;
  const excluded = [...model.literal, ...model.html, ...model.htmlBlocks, ...meta.comments, ...mathRegions(model),
    ...model.nodes.filter((node) => node.name === 'Table'), ...(model.frontmatter ? [model.frontmatter] : [])];
  const inside = overlapIndex(excluded);
  const result: SemanticItem[] = [];
  for (const range of [...meta.comments, ...meta.blockIds]) {
    result.push({ span: range, decoration: Decoration.replace({ block: model.text.slice(range.from, range.to).includes('\n') }) });
  }
  const definitions = new Map<string, { from: number; to: number; url: string }>();
  const footnotes = new Map<string, { from: number; to: number }>();
  for (const match of model.text.matchAll(/^ {0,3}\[([^\]\n]+)\]:[ \t]*([^\n]*)/gm)) {
    const range = { from: match.index!, to: match.index! + match[0].length };
    if (inside(range)) continue;
    if (match[1].startsWith('^')) footnotes.set(match[1].slice(1), { from: range.from, to: range.from + match[0].indexOf(':') + 1 });
    else definitions.set(match[1].toLocaleLowerCase(), { ...range, url: match[2].replace(/\s+"[^"]*"$/, '').replace(/^<|>$/g, '').trim() });
  }
  for (const definition of definitions.values()) {
    result.push({ span: definition, decoration: Decoration.replace({}) });
  }
  for (const node of model.nodes) {
    if (node.name !== 'Link' || inside(node)) continue;
    const raw = model.text.slice(node.from, node.to);
    const match = raw.match(/^\[([^\]]+)\](?:\[([^\]]*)\])?$/);
    if (!match || match[1].startsWith('^')) continue;
    const definition = definitions.get((match[2] || match[1]).toLocaleLowerCase());
    if (definition) result.push({ span: node, decoration: Decoration.replace({ widget: new ReferenceLink(match[1], definition.url) }) });
  }
  const numbers = new Map<string, number>();
  for (const match of model.text.matchAll(/\[\^([^\]\n]+)\](?!:)|\^\[([^\]\n]+)\]/g)) {
    const range = { from: match.index!, to: match.index! + match[0].length };
    if (inside(range)) continue;
    const id = match[1] ?? '@' + range.from;
    if (!numbers.has(id)) numbers.set(id, numbers.size + 1);
    result.push({ span: range, decoration: Decoration.replace({ widget: new FootnoteReference(numbers.get(id)!, footnotes.get(id)?.from ?? -1, match[2] ?? id) }) });
  }
  cache.set(model, result);
  return result;
}
function build(state: EditorState): DecorationSet {
  if (!state.field(livePreviewState)) return Decoration.none;
  const readonly = state.field(livePreviewReadonly);
  const selections = state.field(compositionSelection).selection.ranges;
  const decorations: Range<Decoration>[] = [];
  for (const { span, decoration } of items(state.field(syntaxModel), state.field(documentMetadata))) {
    if (!blockEffectOwns(state, span) && !sourceIsOpen(state, span) && !caretTouches(span, selections, readonly)) decorations.push(decoration.range(span.from, span.to));
  }
  return Decoration.set(decorations, true);
}
export const semanticDecorations = StateField.define<DecorationSet>({
  create: build, update: (value, transaction) => decorationInputsChanged(transaction) ? build(transaction.state) : value,
  provide: (field) => EditorView.decorations.from(field),
});
