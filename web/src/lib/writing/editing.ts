import { Annotation, EditorSelection, type EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';
import { tabstopSpecsToTabstopGroups } from './latex/snippets/tabstop';
import {
  tabstopsStateField,
  restoreTabstopsEffect,
  removeAllTabstopsEffect,
  type TabstopsState,
  addTabstopsEffect,
} from './latex/snippets/codemirror/tabstops_state_field';
import type { SourceChange } from '@webobsidian/markdown-core';
import { snippetGroup } from './latex/snippets/codemirror/history';
export const writingOperation = Annotation.define<'format' | 'paste'>();
export { snippetGroup } from './latex/snippets/codemirror/history';

/** Structured ranges share the native snippet state; returned text stays literal. */
export function insertWritingTemplate(view: EditorView, from: number, to: number, text: string,
  cursors: readonly { order: number; from: number; to: number }[]) {
  const current = view.state.field(tabstopsStateField, false);
  const groups = current && cursors.length ? tabstopSpecsToTabstopGroups(cursors.map(cursor => ({
    index: [cursor.order], from: from + cursor.from, to: from + cursor.to,
  })), current.color % 3) : [];
  view.dispatch({
    changes: { from, to, insert: text },
    selection: groups.length ? groups[0].toEditorSelection() : cursors.length ? EditorSelection.create(cursors
      .filter(cursor => cursor.order === Math.min(...cursors.map(cursor => cursor.order)))
      .map(cursor => EditorSelection.range(from + cursor.from, from + cursor.to))) : { anchor: from + text.length },
    effects: current ? [removeAllTabstopsEffect.of(null), ...(groups.length ? [addTabstopsEffect.of(groups)] : [])] : [],
    userEvent: 'input.template',
    annotations: [isolateHistory.of('full'), snippetGroup.of(`template-${crypto.randomUUID()}`)],
  });
}
export interface WritingViewState {
  selection: ReturnType<EditorSelection['toJSON']>;
  tabstops?: TabstopsState;
}
export function captureWritingState(state: EditorState): WritingViewState {
  const value = state.field(tabstopsStateField, false);
  return {
    selection: state.selection.toJSON(),
    tabstops: value ? { ...value, tabstopGroups: value.tabstopGroups.map((g) => g.copy()) } : undefined,
  };
}
export function restoreWritingState(value: WritingViewState) {
  return {
    selection: EditorSelection.fromJSON(value.selection),
    effects: value.tabstops ? [restoreTabstopsEffect.of(value.tabstops)] : [],
  };
}
export function snippetChangeEffects(state: EditorState, changes: readonly SourceChange[]) {
  const groups = state.field(tabstopsStateField, false)?.tabstopGroups ?? [];
  const overlaps = groups.some((g) =>
    g
      .toSelectionRanges()
      .some((r) =>
        changes.some(
          (c) => (c.from < r.to && c.to > r.from) || (c.from === c.to && c.from >= r.from && c.from <= r.to),
        ),
      ),
  );
  return overlaps ? [removeAllTabstopsEffect.of(null)] : [];
}
