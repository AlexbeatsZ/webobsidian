import { Prec, StateEffect, StateField, type EditorState } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, keymap, type DecorationSet } from '@codemirror/view';
import type { SourceSpan } from '@webobsidian/markdown-core';

export const toggleSourceRegion = StateEffect.define<SourceSpan | null>();
export const sourceRegion = StateField.define<SourceSpan | null>({
  create: () => null,
  update(value, transaction) {
    if (transaction.state.readOnly) return null;
    for (const effect of transaction.effects) if (effect.is(toggleSourceRegion)) return effect.value;
    return value ? { from: transaction.changes.mapPos(value.from, -1), to: transaction.changes.mapPos(value.to, 1) } : null;
  },
});

/** Closing an explicit source entry renders it even if its caret has no outside position. */
export const forcedRenderedRegion = StateField.define<SourceSpan | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(toggleSourceRegion)) {
      return effect.value === null ? transaction.startState.field(sourceRegion) : null;
    }
    return transaction.docChanged || transaction.selection || transaction.state.readOnly ? null : value;
  },
});
export function forceRendered(state: EditorState, range: SourceSpan): boolean {
  const forced = state.field(forcedRenderedRegion, false);
  return Boolean(forced && range.from >= forced.from && range.to <= forced.to);
}

export function sourceIsOpen(state: EditorState, range: SourceSpan): boolean {
  const source = state.field(sourceRegion, false);
  return Boolean(source && range.from < source.to && range.to > source.from);
}

export function sourceOwns(state: EditorState, range: SourceSpan): boolean {
  const source = state.field(sourceRegion, false);
  return Boolean(source && range.from >= source.from && range.to <= source.to);
}

export function sourceButton(view: EditorView, range: SourceSpan, label: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'cm-source-toggle';
  button.textContent = '</>';
  button.title = `Edit ${label} source`;
  button.setAttribute('aria-label', button.title);
  button.addEventListener('mousedown', (event) => {
    event.preventDefault(); event.stopPropagation();
  });
  button.addEventListener('click', (event) => {
    event.preventDefault(); event.stopPropagation();
    if (view.state.readOnly) return;
    view.dispatch({ effects: toggleSourceRegion.of(range), selection: { anchor: range.from }, scrollIntoView: true });
    view.focus();
  });
  return button;
}

class CloseSourceWidget extends WidgetType {
  eq() { return true; }
  toDOM(view: EditorView) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'cm-source-close'; button.textContent = 'Close source';
    button.addEventListener('mousedown', (event) => {
      event.preventDefault(); event.stopPropagation();
    });
    button.addEventListener('click', (event) => {
      event.preventDefault(); event.stopPropagation();
      view.dispatch({ effects: toggleSourceRegion.of(null) });
      view.focus();
    });
    return button;
  }
  ignoreEvent() { return true; }
}
function closeDecoration(state: EditorState): DecorationSet {
  const source = state.field(sourceRegion);
  return source ? Decoration.set([Decoration.widget({ widget: new CloseSourceWidget(), side: -1 }).range(source.from)]) : Decoration.none;
}
const closeField = StateField.define<DecorationSet>({
  create: closeDecoration, update: (_value, transaction) => closeDecoration(transaction.state),
  provide: (field) => EditorView.decorations.from(field),
});
export const sourceControls = [sourceRegion, forcedRenderedRegion, closeField, Prec.highest(keymap.of([{ key: 'Escape', run(view) {
  if (!view.state.field(sourceRegion)) return false;
  view.dispatch({ effects: toggleSourceRegion.of(null) }); return true;
} }]))];
