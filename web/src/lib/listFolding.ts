import { codeFolding, foldEffect, foldedRanges, foldKeymap, foldService, unfoldEffect } from '@codemirror/language';
import { type EditorState, type Range } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, keymap, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view';
import { markdownListLine } from './listLayout';
import { livePreviewState } from './renderState';
import { sourceOwns } from './sourceControls';
import { blockEffectOwns } from './blocks/model';
import { decorationInputsChanged } from './decorationDependencies';
import { iconPaths } from './icons';
import '../styles/lists.css';

/** Resolve the existing Markdown tree at one visible line, without rescanning notes. */
function listRange(state: EditorState, from: number, to: number) {
  const context = markdownListLine(state, state.doc.lineAt(from));
  return context?.header && context.item.to > to ? { from: to, to: context.item.to } : null;
}

class ListFoldWidget extends WidgetType {
  constructor(readonly range: { from: number; to: number }, readonly folded: boolean) { super(); }
  eq(other: ListFoldWidget) { return this.range.from === other.range.from && this.range.to === other.range.to && this.folded === other.folded; }
  toDOM(view: EditorView) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cm-list-fold' + (this.folded ? ' is-folded' : '');
    button.setAttribute('aria-label', this.folded ? 'Expand list item' : 'Collapse list item');
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
    return button;
  }
  ignoreEvent() { return true; }
}

function build(view: EditorView): DecorationSet {
  if (!view.state.field(livePreviewState)) return Decoration.none;
  const decorations: Range<Decoration>[] = [], visited = new Set<number>();
  const folded = foldedRanges(view.state);
  for (const visible of view.visibleRanges) {
    for (let number = view.state.doc.lineAt(visible.from).number, end = view.state.doc.lineAt(visible.to).number; number <= end; number++) {
      const line = view.state.doc.line(number);
      if (visited.has(number) || sourceOwns(view.state, line) || blockEffectOwns(view.state, line)) continue;
      visited.add(number);
      const range = listRange(view.state, line.from, line.to);
      if (!range) continue;
      let collapsed = false;
      folded.between(range.from, range.from, (from, to) => { if (from === range.from && to === range.to) collapsed = true; });
      const marker = line.text.match(/^(?: {0,3}> ?)*[ \t]*/)?.[0].length ?? 0;
      decorations.push(Decoration.widget({ widget: new ListFoldWidget(range, collapsed), side: -1 }).range(line.from + marker));
    }
  }
  return Decoration.set(decorations, true);
}

export const listFolding = [
  codeFolding(), foldService.of(listRange), keymap.of(foldKeymap),
  ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = build(view); }
    update(update: ViewUpdate) {
      if (update.viewportChanged || foldedRanges(update.startState) !== foldedRanges(update.state) ||
        update.transactions.some(tr => decorationInputsChanged(tr, false))) this.decorations = build(update.view);
    }
  }, { decorations: value => value.decorations }),
];
