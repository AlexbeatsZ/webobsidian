import { EditorSelection, StateField, type EditorState } from '@codemirror/state';
import { Decoration, EditorView, RectangleMarker, layer, type DecorationSet } from '@codemirror/view';

// The main selection belongs to the actual text DOM, including wrapped callout
// lines. A rectangular background layer would sit behind opaque block frames
// and paint the full editor width instead of the selected text.
function secondarySelections(state: EditorState): DecorationSet {
  return Decoration.set(state.selection.ranges.flatMap((range, index) =>
    index === state.selection.mainIndex || range.empty ? [] : [
      Decoration.mark({ class: 'cm-secondary-selection' }).range(range.from, range.to),
    ]));
}

const secondaryRanges = StateField.define<DecorationSet>({
  create: secondarySelections,
  update: (value, tr) => tr.selection || tr.docChanged ? secondarySelections(tr.state) : value,
  provide: field => EditorView.decorations.from(field),
});

/** Native primary caret/selection, plus independent cursors for multicursor edits. */
export const editorSelection = [secondaryRanges, layer({
  above: true,
  class: 'cm-secondary-cursors',
  update: update => update.selectionSet || update.docChanged || update.geometryChanged || update.focusChanged,
  markers(view) {
    if (!view.hasFocus || !view.state.facet(EditorView.editable)) return [];
    return view.state.selection.ranges.flatMap((range, index) => index === view.state.selection.mainIndex ? [] :
      RectangleMarker.forRange(view, 'cm-cursor cm-cursor-secondary',
        EditorSelection.cursor(range.head, range.assoc, range.bidiLevel ?? undefined)));
  },
})];
