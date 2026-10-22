import { Annotation, EditorSelection, type EditorState } from '@codemirror/state';
import {
  tabstopsStateField,
  restoreTabstopsEffect,
  removeAllTabstopsEffect,
  type TabstopsState,
} from './latex/snippets/codemirror/tabstops_state_field';
import type { SourceChange } from '@webobsidian/markdown-core';
export const writingOperation = Annotation.define<'format' | 'paste'>();
export { snippetGroup } from './latex/snippets/codemirror/history';
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
