import { StateField, type EditorState, type Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { caretTouches, type SourceSpan } from '@webobsidian/markdown-core';
import { syntaxModel, documentMetadata } from './syntaxModel';
import { livePreviewState, livePreviewReadonly } from './renderState';
import { compositionSelection } from './inlineHtml';
import { sourceIsOpen } from './sourceControls';
import { contextOf } from './renderContext';

class ReferenceLink extends WidgetType {
  constructor(readonly label: string, readonly target: string) { super(); }
  eq(other: ReferenceLink) { return other.label === this.label && other.target === this.target; }
  toDOM(view: EditorView) {
    const anchor = document.createElement('a');
    anchor.className = 'cm-md-link'; anchor.textContent = this.label; anchor.title = this.target;
    anchor.addEventListener('mousedown', (event) => {
      event.preventDefault(); event.stopPropagation();
      if (/^(?:https?|mailto):/i.test(this.target)) window.open(this.target, '_blank', 'noopener');
      else if (!/^[a-z][a-z\d+.-]*:/i.test(this.target)) contextOf(view).openLink(this.target);
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

function build(state: EditorState): DecorationSet {
  if (!state.field(livePreviewState)) return Decoration.none;
  const model = state.field(syntaxModel), meta = state.field(documentMetadata);
  const readonly = state.field(livePreviewReadonly);
  const selections = state.field(compositionSelection).selection.ranges;
  const reveal = (span: SourceSpan) => sourceIsOpen(state, span) || caretTouches(span, selections, readonly);
  const excluded = [...model.literal, ...model.html, ...model.htmlBlocks, ...meta.comments,
    ...model.nodes.filter((node) => node.name === 'Table'), ...(model.frontmatter ? [model.frontmatter] : [])];
  const inside = (span: SourceSpan) => excluded.some((range) => span.from < range.to && span.to > range.from);
  const decorations: Range<Decoration>[] = [];
  for (const range of [...meta.comments, ...meta.blockIds]) {
    if (!reveal(range)) decorations.push(Decoration.replace({ block: model.text.slice(range.from, range.to).includes('\n') }).range(range.from, range.to));
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
    if (!reveal(definition)) decorations.push(Decoration.replace({}).range(definition.from, definition.to));
  }
  for (const node of model.nodes) {
    if (node.name !== 'Link' || inside(node) || reveal(node)) continue;
    const raw = model.text.slice(node.from, node.to);
    const match = raw.match(/^\[([^\]]+)\](?:\[([^\]]*)\])?$/);
    if (!match || match[1].startsWith('^')) continue;
    const definition = definitions.get((match[2] || match[1]).toLocaleLowerCase());
    if (definition) decorations.push(Decoration.replace({ widget: new ReferenceLink(match[1], definition.url) }).range(node.from, node.to));
  }
  const numbers = new Map<string, number>();
  for (const match of model.text.matchAll(/\[\^([^\]\n]+)\](?!:)|\^\[([^\]\n]+)\]/g)) {
    const range = { from: match.index!, to: match.index! + match[0].length };
    if (inside(range)) continue;
    const id = match[1] ?? '@' + range.from;
    if (!numbers.has(id)) numbers.set(id, numbers.size + 1);
    if (!reveal(range)) decorations.push(Decoration.replace({ widget: new FootnoteReference(numbers.get(id)!, footnotes.get(id)?.from ?? -1, match[2] ?? id) }).range(range.from, range.to));
  }
  return Decoration.set(decorations, true);
}
export const semanticDecorations = StateField.define<DecorationSet>({
  create: build, update: (_value, transaction) => build(transaction.state),
  provide: (field) => EditorView.decorations.from(field),
});
