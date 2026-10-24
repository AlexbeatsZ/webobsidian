import { Prec, StateEffect, StateField, type EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import type { SourceSpan } from '@webobsidian/markdown-core';
import { compositionSelection } from './editorSelection';
import { recordDebug } from './debug';

/** Every source entry is temporary; only source coordinates belong in this state. */
export const toggleSourceRegion = StateEffect.define<SourceSpan | null>();
/** Navigation retains the existing rendered representation without opening source. */
export const renderSourceRegion = StateEffect.define<SourceSpan>();
export const sourceRegion = StateField.define<SourceSpan | null>({
  create: () => null,
  update(value, transaction) {
    if (transaction.state.readOnly) return null;
    if (transaction.effects.some(effect => effect.is(renderSourceRegion))) return null;
    for (const effect of transaction.effects) if (effect.is(toggleSourceRegion))
      return effect.value ? { from: effect.value.from, to: effect.value.to } : null;
    if (!value) return null;
    const mapped = transaction.docChanged ? {
      from: transaction.changes.mapPos(value.from, -1), to: transaction.changes.mapPos(value.to, 1) } : value;
    if (!transaction.state.field(compositionSelection).selection.ranges.some(range =>
      range.empty ? range.from >= mapped.from && range.from <= mapped.to : range.from < mapped.to && range.to > mapped.from)) return null;
    return mapped;
  },
});

/** Escape/blur restore rendering even when the caret has no outside position. */
export const forcedRenderedRegion = StateField.define<SourceSpan | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(renderSourceRegion)) return effect.value;
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

export function sourceButton(view: EditorView, range: SourceSpan | (() => SourceSpan), label: string,
  options: { selection?: SourceSpan } = {}): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'cm-source-toggle';
  button.textContent = '</>';
  button.title = `编辑${label}源码`;
  button.setAttribute('aria-label', button.title);
  button.addEventListener('mousedown', (event) => {
    event.preventDefault(); event.stopPropagation();
  });
  button.addEventListener('click', (event) => {
    event.preventDefault(); event.stopPropagation();
    if (view.state.readOnly) return;
    const current = typeof range === 'function' ? range() : range;
    const selection = options.selection;
    recordDebug('source.open', { label, range: current, selection });
    view.dispatch({ effects: toggleSourceRegion.of({ from: current.from, to: current.to }),
      selection: { anchor: selection?.from ?? current.from, head: selection?.to ?? current.from }, scrollIntoView: true });
    view.focus();
  });
  return button;
}

export const sourceControls = [compositionSelection, sourceRegion, forcedRenderedRegion,
  EditorView.domEventHandlers({ blur(event, view) {
    if (event.relatedTarget instanceof Node && view.dom.contains(event.relatedTarget)) return false;
    queueMicrotask(() => {
      if (view.dom.isConnected && !view.hasFocus && view.state.field(sourceRegion))
        view.dispatch({ effects: toggleSourceRegion.of(null) });
    });
    return false;
  } }), Prec.highest(keymap.of([{ key: 'Escape', run(view) {
  if (!view.state.field(sourceRegion)) return false;
  view.dispatch({ effects: toggleSourceRegion.of(null) }); return true;
} }]))];
