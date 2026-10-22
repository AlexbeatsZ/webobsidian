import { Annotation } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
/** DocumentSession owns text and tabstop restoration; this annotation only groups edits. */
export const snippetGroup = Annotation.define<string>();
let sequence = 0;
const groups = new WeakMap<EditorView, string>();
export const snippetOperation = (view: EditorView) => groups.get(view) ?? `snippet:${++sequence}`;
export function withSnippetOperation<T>(view: EditorView, run: () => T): T {
  if (groups.has(view)) return run();
  groups.set(view, `snippet:${++sequence}`);
  try {
    return run();
  } finally {
    groups.delete(view);
  }
}
