import { StateField, type EditorState, type Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { caretTouches, decodeHtmlEntity, simpleHtmlTags, type HtmlToken, type SourceSpan } from '@webobsidian/markdown-core';
import { syntaxModel, blockModel } from './syntaxModel';
import { sourceIsOpen, forceRendered } from './sourceControls';
import { livePreviewState, livePreviewReadonly } from './renderState';
import { blockEffectOwns } from './blocks/model';
import { compositionSelection, compositionEvents } from './editorSelection';
import { decorationInputsChanged } from './decorationDependencies';
export { compositionSelection } from './editorSelection';

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
  const ownedRanges = [...model.nodes.filter((node) => node.name === 'Table'), ...state.field(blockModel).mathRanges];
  const ownedByBlock = (span: SourceSpan) => ownedRanges.some((range) => span.from < range.to && span.to > range.from);
  const reveal = (span: SourceSpan) => !forceRendered(state, span) && caretTouches(span, selections, readonly);
  const ranges: Range<Decoration>[] = [];
  const stack: HtmlToken[] = [];
  for (const token of model.html) {
    if (ownedByBlock(token) || blockEffectOwns(state, token) || sourceIsOpen(state, token)) continue;
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
    if (!ownedByBlock(entity) && !blockEffectOwns(state, entity) && !sourceIsOpen(state, entity) && !reveal(entity)) ranges.push(Decoration.replace({
      widget: new EntityWidget(decodeHtmlEntity(model.text.slice(entity.from, entity.to))),
    }).range(entity.from, entity.to));
  }
  return Decoration.set(ranges, true);
}

const htmlField = StateField.define<DecorationSet>({
  create: build,
  update(value, transaction) {
    return decorationInputsChanged(transaction, { selection: true, context: ['allowBlockEffects', 'allowScriptExecution'], latex: false }) ? build(transaction.state) : value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export const inlineHtml = [compositionSelection, htmlField, compositionEvents];
