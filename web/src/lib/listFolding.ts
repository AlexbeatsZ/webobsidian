import { codeFolding, foldable, foldEffect, foldedRanges, foldKeymap, foldService, unfoldEffect } from '@codemirror/language';
import { EditorState, type Range, type StateEffect } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, keymap, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view';
import { markdownListFold, markdownListLine } from './listLayout';
import { livePreviewState } from './renderState';
import { sourceOwns } from './sourceControls';
import { blockEffectOwns } from './blocks/model';
import { decorationInputsChanged } from './decorationDependencies';
import { iconPaths } from './icons';
import { adoptSyntaxModel, syntaxModel } from './syntaxModel';
import '../styles/lists.css';

/** Resolve the existing Markdown tree at one visible line, without rescanning notes. */
function listRange(state: EditorState, from: number, to: number) {
  const range = markdownListFold(state, state.doc.lineAt(from));
  return range && range.from === to ? range : null;
}

class ListFoldWidget extends WidgetType {
  constructor(readonly range: { from: number; to: number }, readonly folded: boolean, readonly heading = 0) { super(); }
  eq(other: ListFoldWidget) { return this.range.from === other.range.from && this.range.to === other.range.to && this.folded === other.folded && this.heading === other.heading; }
  toDOM(view: EditorView) {
    const anchor = document.createElement('span');
    anchor.className = 'cm-list-fold-anchor' + (this.heading ? ' cm-heading-controls' : '');
    if (this.heading) {
      const label = document.createElement('span');
      label.className = 'cm-heading-label'; label.textContent = `H${this.heading}`;
      label.setAttribute('aria-hidden', 'true'); anchor.appendChild(label);
    }
    if (this.range.to <= this.range.from) return anchor;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cm-list-fold' + (this.folded ? ' is-folded' : '');
    button.setAttribute('aria-label', this.heading ? (this.folded ? '展开标题章节' : '折叠标题章节') : (this.folded ? '展开列表项' : '折叠列表项'));
    button.setAttribute('aria-expanded', String(!this.folded));
    button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + iconPaths['chevron-down'] + '</svg>';
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation();
      if (view.composing) return;
      const hidesCaret = !this.folded && view.state.selection.ranges.some(range => range.to > this.range.from && range.from < this.range.to);
      view.dispatch({ effects: (this.folded ? unfoldEffect : foldEffect).of(this.range),
        ...(hidesCaret ? { selection: { anchor: this.range.from } } : {}),
      });
    });
    anchor.appendChild(button);
    return anchor;
  }
  ignoreEvent() { return true; }
}

function build(view: EditorView): DecorationSet {
  const live = view.state.field(livePreviewState);
  const decorations: Range<Decoration>[] = [], visited = new Set<number>();
  const folded = foldedRanges(view.state);
  for (const visible of view.visibleRanges) {
    for (let number = view.state.doc.lineAt(visible.from).number, end = view.state.doc.lineAt(visible.to).number; number <= end; number++) {
      const line = view.state.doc.line(number);
      if (visited.has(number) || sourceOwns(view.state, line) || blockEffectOwns(view.state, line)) continue;
      visited.add(number);
      // The Markdown language already owns section ends. BodyHeading (#######)
      // is deliberately excluded; no second section parser or fold state.
      let heading = 0, headingFrom = line.from;
      for (let node = view.state.field(syntaxModel).tree.resolveInner(line.to, -1); node && node.from >= line.from; node = node.parent!) {
        const match = /^(?:ATX|Setext)Heading([1-6])$/.exec(node.name);
        if (match) { heading = Number(match[1]); headingFrom = node.from; break; }
      }
      if (!live && !heading) continue;
      const range = heading ? foldable(view.state, line.from, line.to) ?? { from: line.to, to: line.to } : listRange(view.state, line.from, line.to);
      if (!range) continue;
      let collapsed = false;
      let controlRange = range;
      folded.between(range.from, range.from, (from, to) => {
        if (from === range.from && to <= range.to) { collapsed = true; controlRange = { from, to }; }
      });
      const marker = line.text.match(/^(?: {0,3}> ?)*[ \t]*/)?.[0].length ?? 0;
      if (heading) decorations.push(Decoration.line({ attributes: { 'data-native-heading-gutter': 'true' } }).range(line.from));
      if (collapsed) decorations.push(Decoration.line({ class: 'cm-list-folded' }).range(line.from));
      decorations.push(Decoration.widget({ widget: new ListFoldWidget(controlRange, collapsed, heading), side: -1 }).range(heading ? headingFrom : line.from + marker));
    }
  }
  return Decoration.set(decorations, true);
}

export const listFolding = [
  codeFolding(), foldService.of(listRange), keymap.of(foldKeymap),
  // A null fold service result falls back to Markdown's whole ListItem. Keep
  // every native keyboard/plugin request inside the same explicit source bound.
  EditorState.transactionExtender.of(transaction => {
    const requestsFold = transaction.effects.some(effect => effect.is(foldEffect));
    if (!requestsFold && (!transaction.docChanged || !foldedRanges(transaction.startState).size)) return null;
    const state = transaction.state;
    const effects: StateEffect<unknown>[] = [];
    foldedRanges(state).between(0, state.doc.length, (from, to) => {
      const line = state.doc.lineAt(from);
      if (from !== line.to || !markdownListLine(state, line)?.header) return;
      const range = markdownListFold(state, line);
      if (range && to <= range.to) return;
      effects.push(unfoldEffect.of({ from, to }));
      if (range) effects.push(foldEffect.of(range));
    });
    // Extending reconstructs the transaction. Reuse the model already analyzed
    // above rather than parsing the same document again for the added effects.
    if (effects.length && transaction.docChanged) effects.push(adoptSyntaxModel.of(state.field(syntaxModel)));
    return effects.length ? { effects } : null;
  }),
  ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = build(view); }
    update(update: ViewUpdate) {
      if (update.viewportChanged || foldedRanges(update.startState) !== foldedRanges(update.state) ||
        update.transactions.some(tr => decorationInputsChanged(tr, false))) this.decorations = build(update.view);
    }
  }, { decorations: value => value.decorations }),
];
