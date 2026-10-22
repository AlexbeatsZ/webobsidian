import { EditorView } from '@codemirror/view';
import { fragmentRange } from '@webobsidian/markdown-core';
import { syntaxModel } from './syntaxModel';
import { contextOf } from './renderContext';

const views = new Map<string, Map<EditorView, boolean>>();
const pending = new Map<string, string>();
function reveal(view: EditorView, fragment: string) {
  const source = contextOf(view).mathSource;
  const range = fragmentRange(source?.model ?? view.state.field(syntaxModel), fragment);
  const from = range && range.from - (source?.from ?? 0);
  if (from === null || from === undefined || from < 0 || from > view.state.doc.length) return false;
  view.dispatch({ selection: { anchor: from }, effects: EditorView.scrollIntoView(from, { y: 'center' }) });
  if (!view.state.readOnly) view.focus();
  return true;
}
/** One navigation path for headings, ordinary blocks and formula blocks. */
export function openFragment(path: string, fragment: string, target?: EditorView) {
  const mounted = [...(views.get(path) ?? [])].filter(([view, full]) => full && view.dom.isConnected
    && !view.dom.closest('[hidden], [aria-hidden="true"]')).map(([view]) => view);
  const view = target && mounted.includes(target) ? target : mounted.find(v => v.hasFocus) ?? mounted[0];
  pending.set(path, fragment);
  if (view) requestAnimationFrame(() => { if (views.get(path)?.has(view) && reveal(view, fragment)) pending.delete(path); });
}
export function bindFragmentNavigation(view: EditorView, path: string, full: boolean): () => void {
  let mounted = views.get(path); if (!mounted) views.set(path, mounted = new Map());
  mounted.set(view, full);
  const target = pending.get(path);
  if (full && target !== undefined) requestAnimationFrame(() => {
    if (mounted!.has(view) && pending.get(path) === target && reveal(view, target)) pending.delete(path);
  });
  return () => { mounted!.delete(view); if (!mounted!.size) views.delete(path); };
}
