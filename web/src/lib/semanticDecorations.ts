import { StateField, type EditorState, type Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { caretTouches, footnotes, footnoteFragment, footnoteReferenceFragment, equationContext, extractMetadata,
  type SourceSpan, type MarkdownModel, type Footnote } from '@webobsidian/markdown-core';
import { syntaxModel, sourceOf } from './syntaxModel';
import { livePreviewState, livePreviewReadonly } from './renderState';
import { compositionSelection } from './inlineHtml';
import { sourceIsOpen, forceRendered } from './sourceControls';
import { navigationHighlight } from './fragmentNavigation';
import { bindRenderedLink } from './linkPreview';
import { contextOf, renderContext, nonExecutingContext } from './renderContext';
import { decorationInputsChanged } from './decorationDependencies';
import { blockEffectOwns } from './blocks/model';
import { getIcon } from './icons';
import { mathDefinitionContext } from './mathjax';

class ReferenceLink extends WidgetType {
  constructor(readonly label: string, readonly target: string, readonly unresolved = false, readonly footnote: boolean | 'definition' = false, readonly highlighted = false) { super(); }
  eq(other: ReferenceLink) { return other.label === this.label && other.target === this.target && other.unresolved === this.unresolved && other.footnote === this.footnote && other.highlighted === this.highlighted; }
  toDOM(view: EditorView) {
    const anchor = document.createElement('a');
    const external = /^https?:/i.test(this.target);
    anchor.className = this.footnote ? 'cm-footref cm-footnote-' + (this.footnote === 'definition' ? 'definition' : 'reference') + (this.unresolved ? ' is-unresolved' : '') : 'cm-md-link ' + (external ? 'external-link' : 'internal-link');
    if (this.highlighted) anchor.classList.add('cm-navigation-target');
    anchor.textContent = this.label; anchor.title = this.unresolved ? '脚注定义缺失或重复' : this.target;
    if (external && !this.footnote) { const icon = getIcon('external-link'); icon.classList.add('cm-external-icon'); anchor.append(icon); }
    if (this.footnote === 'definition') anchor.setAttribute('aria-label', '返回脚注 ' + this.label + ' 的第一处引用');
    bindRenderedLink(anchor, view, this.target, !!this.footnote); return anchor;
  }
  ignoreEvent() { return true; }
}
class FootnoteBody extends WidgetType {
  stops: (() => void)[] = [];
  readonly content: string;
  readonly dependencies: string;
  constructor(readonly note: Footnote, readonly model: MarkdownModel, readonly highlighted: boolean, readonly noteContext: string) {
    super(); const definition = note.definitions[0];
    this.content = definition ? model.text.slice(definition.from, definition.to) : '';
    this.dependencies = JSON.stringify([mathDefinitionContext(model, definition?.to ?? 0), equationContext(model).equations.map(e => [e.id, e.number, e.ambiguous])]);
  }
  eq(other: FootnoteBody) {
    return this.content === other.content && this.note.id === other.note.id && this.note.number === other.note.number && this.noteContext === other.noteContext
      && this.note.references.length === other.note.references.length && this.highlighted === other.highlighted && this.dependencies === other.dependencies;
  }
  toDOM(view: EditorView) {
    const context = contextOf(view), entry = document.createElement('section');
    entry.className = 'cm-footnote-entry' + (this.note.number === 1 ? ' is-first' : '') + (this.highlighted ? ' cm-navigation-target' : '');
    entry.dataset.footnoteTarget = footnoteFragment(this.note);
    const number = document.createElement('a'); number.className = 'cm-footnote-number'; number.textContent = String(this.note.number) + '.';
    number.setAttribute('aria-label', '返回脚注 ' + this.note.number + ' 的第一处引用');
    bindRenderedLink(number, view, '#' + footnoteReferenceFragment(this.note, 0), true);
    const body = document.createElement('div'); body.className = 'cm-footnote-body';
    const text = document.createElement('div'); body.append(text); entry.append(number, body);
    const definition = this.note.definitions[0];
    if (definition && this.note.status === 'resolved') {
      const from = this.note.inline ? definition.bodyFrom : definition.from;
      const to = this.note.inline ? definition.to - 1 : definition.to;
      const stop = context.mountFragment?.(text, this.model.text.slice(from, to), { id: context.sourcePath + '#footnote-' + this.note.number,
        mode: 'reading', sourceFrom: from, equations: equationContext(this.model, from), mathSource: { model: this.model, from },
        context: { ...nonExecutingContext(context), footnoteBody: true, navigationId: undefined, recordNavigation: undefined } });
      if (stop) this.stops.push(stop);
    } else text.textContent = this.note.status === 'missing' ? '未找到脚注定义：' + this.note.id : '脚注定义重复：' + this.note.id;
    const returns = document.createElement('nav'); returns.className = 'cm-footnote-returns'; returns.setAttribute('aria-label', '返回脚注引用');
    this.note.references.forEach((_, index) => {
      const anchor = document.createElement('a'); anchor.textContent = this.note.references.length > 1 ? '↩' + (index + 1) : '↩';
      anchor.setAttribute('aria-label', '返回第 ' + (index + 1) + ' 处引用');
      bindRenderedLink(anchor, view, '#' + footnoteReferenceFragment(this.note, index), true); returns.append(anchor);
    });
    body.append(returns); return entry;
  }
  destroy() { for (const stop of this.stops) stop(); this.stops = []; }
  ignoreEvent() { return true; }
}
type SemanticItem = { span: SourceSpan; decoration: Decoration };
const cache = new WeakMap<MarkdownModel, SemanticItem[]>();
const footnoteContexts = new WeakMap<MarkdownModel, string>();
function items(model: MarkdownModel): SemanticItem[] {
  const cached = cache.get(model); if (cached) return cached;
  const meta = extractMetadata(model), result: SemanticItem[] = [];
  for (const range of [...meta.comments, ...meta.blockIds, ...meta.linkDefinitions])
    result.push({ span: range, decoration: Decoration.replace({ block: model.text.slice(range.from, range.to).includes('\n') }) });
  for (const link of meta.linkOccurrences) if (link.kind !== 'wiki' && !link.embed)
    result.push({ span: link, decoration: Decoration.replace({ widget: new ReferenceLink(link.label || link.target, link.target) }) });
  cache.set(model, result); return result;
}
function build(state: EditorState): DecorationSet {
  if (!state.field(livePreviewState)) return Decoration.none;
  const readonly = state.field(livePreviewReadonly), context = state.facet(renderContext);
  const local = state.field(syntaxModel), { from: offset, model: full } = sourceOf(state);
  const selections = state.field(compositionSelection).selection.ranges, decorations: Range<Decoration>[] = [];
  const visible = (span: SourceSpan) => !blockEffectOwns(state, span) && !sourceIsOpen(state, span)
    && (forceRendered(state, span) || !caretTouches(span, selections, readonly));
  for (const { span, decoration } of items(local)) if (visible(span)) decorations.push(decoration.range(span.from, span.to));
  const notes = footnotes(full), target = navigationHighlight(state);
  for (const note of notes.notes) {
    for (const reference of note.references) {
      const span = { from: reference.from - offset, to: reference.to - offset };
      if (span.from < 0 || span.to > local.text.length || !visible(span)) continue;
      decorations.push(Decoration.replace({ widget: new ReferenceLink(String(note.number), '#' + footnoteFragment(note), note.status !== 'resolved', true,
        !!target && target.from === span.from && target.to === span.to) }).range(span.from, span.to));
    }
    for (const definition of note.definitions) {
      if (note.inline) continue;
      const from = definition.from - offset, to = definition.to - offset, markerTo = definition.markerTo - offset;
      if (from < 0 || to > local.text.length) continue;
      if (readonly && !context.footnoteBody) decorations.push(Decoration.replace({ block: true }).range(from, to));
      else if (readonly || visible({ from, to })) decorations.push(Decoration.replace({ widget: !readonly && note.references.length
        ? new ReferenceLink(String(note.number), '#' + footnoteReferenceFragment(note, 0), false, 'definition') : undefined }).range(from, markerTo));
    }
  }
  if (readonly && !context.footnoteBody && !context.embedTrail?.length && !offset) {
    let noteContext = footnoteContexts.get(full);
    if (noteContext === undefined) {
      noteContext = JSON.stringify(notes.notes.map(note => [note.id, note.number, note.status, note.references,
        note.definitions.map(def => [def.from, def.to, full.text.slice(def.from, def.to)])]));
      footnoteContexts.set(full, noteContext);
    }
    for (const note of notes.notes) if (note.number) {
      const highlighted = !!target && note.definitions.some(def => def.from === target.from && def.to === target.to);
      decorations.push(Decoration.widget({ widget: new FootnoteBody(note, full, highlighted, noteContext), block: true, side: 1 }).range(local.text.length));
    }
  }
  return Decoration.set(decorations, true);
}
export const semanticDecorations = StateField.define<DecorationSet>({
  create: build, update: (value, transaction) => decorationInputsChanged(transaction)
    || navigationHighlight(transaction.startState) !== navigationHighlight(transaction.state) ? build(transaction.state) : value,
  provide: field => EditorView.decorations.from(field),
});
