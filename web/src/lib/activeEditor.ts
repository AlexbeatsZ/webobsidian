import { contextOf } from './renderContext';
import type { EditorView } from '@codemirror/view';
import { indentMore, indentLess } from '@codemirror/commands';
import { openSearchPanel } from '@codemirror/search';
import { toggleInline, toggleChecklist, insertLink } from './editorCommands';

interface EditorCommands {
  undo: () => boolean;
  redo: () => boolean;
}
const mounted = new Map<EditorView, EditorCommands>();
let active: EditorView | null = null;

export function registerEditor(view: EditorView, commands: EditorCommands): () => void {
  mounted.set(view, commands);
  const focus = (event: FocusEvent) => {
    if ((event.target as Element).closest('.cm-editor') === view.dom) active = view;
  };
  view.dom.addEventListener('focusin', focus);
  return () => {
    view.dom.removeEventListener('focusin', focus);
    mounted.delete(view);
    if (active === view) active = null;
  };
}
export function getActiveEditor(): EditorView | null {
  return active && mounted.has(active) ? active : null;
}
export function getEditorForPath(path: string): EditorView | null {
  if (active && mounted.has(active) && contextOf(active).sourcePath === path) return active;
  return [...mounted.keys()].find((view) => contextOf(view).sourcePath === path) ?? null;
}
const editable = () => {
  const view = getActiveEditor();
  return view && !view.state.readOnly ? view : null;
};

/** Wrap the selection (or word at caret) in a pair of marks; unwrap if already wrapped. */
export function fmtInline(mark: string) {
  const v = editable();
  if (v) toggleInline(v, mark);
}

/** Toggle a task checkbox / continue checklist on the selected lines. */
export function fmtChecklist() {
  const v = editable();
  if (v) toggleChecklist(v);
}

/** Prefix each selected line with `prefix` (heading, bullet, quote…). */
export function fmtPrefixLines(prefix: string) {
  const v = editable();
  if (!v) return;
  const { from, to } = v.state.selection.main;
  const a = v.state.doc.lineAt(from).number;
  const b = v.state.doc.lineAt(to).number;
  const changes = [];
  for (let n = a; n <= b; n++) changes.push({ from: v.state.doc.line(n).from, insert: prefix });
  v.dispatch({ changes, userEvent: 'input' });
  v.focus();
}

/** Insert text at the caret; place caret `caretOffset` chars in (default end). */
export function fmtInsert(text: string, caretOffset = text.length) {
  const v = editable();
  if (!v) return;
  const { from, to } = v.state.selection.main;
  v.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + caretOffset },
    userEvent: 'input',
  });
  v.focus();
}

export function fmtLink() {
  const v = editable();
  if (v) insertLink(v);
}
export function fmtIndent() {
  const v = editable();
  if (v) {
    indentMore(v);
    v.focus();
  }
}
export function fmtOutdent() {
  const v = editable();
  if (v) {
    indentLess(v);
    v.focus();
  }
}
export function fmtUndo() {
  const v = editable();
  if (v) {
    mounted.get(v)?.undo();
    v.focus();
  }
}
export function fmtRedo() {
  const v = editable();
  if (v) {
    mounted.get(v)?.redo();
    v.focus();
  }
}

/** Open the in-document Find/Replace panel (CM6 search panel includes both). */
export function editorFind(): boolean {
  const v = getActiveEditor();
  if (!v) return false;
  openSearchPanel(v);
  return true;
}
