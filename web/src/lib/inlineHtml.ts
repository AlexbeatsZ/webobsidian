import { EditorSelection, StateEffect, StateField, type EditorState, type Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { caretTouches, decodeHtmlEntity, simpleHtmlTags, type HtmlToken, type SourceSpan } from '@webobsidian/markdown-core';
import { syntaxModel, blockModel } from './syntaxModel';
import { sourceIsOpen, forceRendered, toggleSourceRegion } from './sourceControls';
import { livePreviewState, livePreviewReadonly, setLivePreviewEnabled, setLivePreviewReadonly } from './renderState';

const composition = StateEffect.define<boolean>();
export const compositionSelection = StateField.define<{ active: boolean; selection: EditorSelection }>({
  create: (state) => ({ active: false, selection: state.selection }),
  update(value, transaction) {
    const change = transaction.effects.find((effect) => effect.is(composition));
    const active = change ? change.value : value.active;
    return { active, selection: active ? value.selection.map(transaction.changes) : transaction.newSelection };
  },
});

class BreakWidget extends WidgetType {
  constructor(readonly from: number, readonly to: number) { super(); }
  eq(other: BreakWidget) { return other.from === this.from && other.to === this.to; }
  get lineBreaks() { return 1; }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-html-break';
    span.dataset.sourceFrom = String(this.from);
    span.dataset.sourceTo = String(this.to);
    span.appendChild(document.createElement('br'));
    return span;
  }
  ignoreEvent() { return false; }
}

class EntityWidget extends WidgetType {
  constructor(readonly text: string) { super(); }
  eq(other: EntityWidget) { return this.text === other.text; }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-html-entity';
    span.textContent = this.text;
    return span;
  }
  ignoreEvent() { return false; }
}

function build(state: EditorState): DecorationSet {
  if (!state.field(livePreviewState, false)) return Decoration.none;
  const model = state.field(syntaxModel);
  const selections = state.field(compositionSelection).selection.ranges;
  const readonly = state.field(livePreviewReadonly, false) ?? false;
  const tables = [...model.nodes.filter((node) => node.name === 'Table'), ...state.field(blockModel).math];
  const ownedByTable = (span: SourceSpan) => tables.some((table) => span.from >= table.from && span.to <= table.to);
  const reveal = (span: SourceSpan) => !forceRendered(state, span) && caretTouches(span, selections, readonly);
  const ranges: Range<Decoration>[] = [];
  const stack: HtmlToken[] = [];
  for (const token of model.html) {
    if (ownedByTable(token) || sourceIsOpen(state, token)) continue;
    if (token.tag === 'br' && !token.closing) {
      if (!reveal(token)) ranges.push(Decoration.replace({ widget: new BreakWidget(token.from, token.to) }).range(token.from, token.to));
    } else if (simpleHtmlTags.has(token.tag)) {
      if (!token.closing) stack.push(token);
      else if (stack.at(-1)?.tag === token.tag) {
        const opening = stack.pop()!;
        if (opening.to < token.from) ranges.push(Decoration.mark({ tagName: token.tag, class: 'md-html-' + token.tag }).range(opening.to, token.from));
        if (!reveal({ from: opening.from, to: token.to })) {
          ranges.push(Decoration.replace({}).range(opening.from, opening.to));
          ranges.push(Decoration.replace({}).range(token.from, token.to));
        }
      }
    }
  }
  for (const entity of model.entities) {
    if (!ownedByTable(entity) && !sourceIsOpen(state, entity) && !reveal(entity)) ranges.push(Decoration.replace({
      widget: new EntityWidget(decodeHtmlEntity(model.text.slice(entity.from, entity.to))),
    }).range(entity.from, entity.to));
  }
  return Decoration.set(ranges, true);
}

const htmlField = StateField.define<DecorationSet>({
  create: build,
  update(value, transaction) {
    return transaction.docChanged || transaction.selection || transaction.effects.some((effect) =>
        effect.is(composition) || effect.is(setLivePreviewEnabled) || effect.is(setLivePreviewReadonly) || effect.is(toggleSourceRegion))
      ? build(transaction.state) : value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export const inlineHtml = [compositionSelection, htmlField, EditorView.domEventHandlers({
  compositionstart(_event, view) { view.dispatch({ effects: composition.of(true) }); return false; },
  compositionend(_event, view) {
    queueMicrotask(() => { if (view.dom.isConnected) view.dispatch({ effects: composition.of(false) }); });
    return false;
  },
})];
