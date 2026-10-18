import { useEffect, useMemo, useRef, useSyncExternalStore, type MutableRefObject } from 'react';
import { DocumentSession } from '@webobsidian/markdown-core';
import type { EditorView } from '@codemirror/view';
import MarkdownView from './MarkdownView';
import { registerEditor } from '../lib/activeEditor';
import { createVaultRenderContext } from '../lib/vaultRenderContext';
import { useStore } from '../lib/store';

/** Small adapter for the existing Canvas format menus; all edits go through CM. */
export interface CanvasTextHandle {
  readonly rawValue: string;
  value: string; selectionStart: number; selectionEnd: number;
  contains: (node: Node) => boolean; focus: () => void; select: () => void;
  getBoundingClientRect: () => DOMRect;
}
export default function CanvasMarkdown({ id, source, path, editing = false, handle }: {
  id: string; source: string; path: string; editing?: boolean; handle?: MutableRefObject<CanvasTextHandle | null>;
}) {
  const session = useMemo(() => new DocumentSession(id, source, undefined, async () => ({})), [id]);
  const snapshot = useSyncExternalStore(session.subscribe, () => session.snapshot);
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const unbind = useRef<(() => void) | undefined>();
  const openLink = useStore(s => s.openWikilink), openMenu = useStore(s => s.openContextMenu);
  const tree = useStore(s => s.tree);
  const context = useMemo(() => createVaultRenderContext(path, {
    openLink: (target, from) => { void openLink(target, from); }, openMenu, bindEditor: registerEditor,
    files: () => { const out: string[] = []; const walk = (node: NonNullable<typeof tree>) => { if (node.type === 'file') out.push(node.path); node.children?.forEach(walk); }; if (tree) walk(tree); return out; },
  }), [path, openLink, openMenu, tree]);
  useEffect(() => { if (!editing) session.setRawText(source); }, [source, editing, session]);
  useEffect(() => {
    const v = editor.current;
    if (!handle || !v || !editing) return;
    const clamp = (n: number) => Math.max(0, Math.min(n, v.state.doc.length));
    const bridge: CanvasTextHandle = {
      get rawValue() { return session.snapshot.raw; },
      get value() { return v.state.doc.toString(); },
      set value(text) {
        const before = v.state.doc.toString(); let a = 0, b = before.length, c = text.length;
        while (a < b && a < c && before[a] === text[a]) a++;
        while (b > a && c > a && before[b - 1] === text[c - 1]) { b--; c--; }
        v.dispatch({ changes: { from: a, to: b, insert: text.slice(a, c) } });
      },
      get selectionStart() { return v.state.selection.main.from; },
      set selectionStart(n) { v.dispatch({ selection: { anchor: clamp(n), head: Math.max(clamp(n), v.state.selection.main.to) } }); },
      get selectionEnd() { return v.state.selection.main.to; },
      set selectionEnd(n) { v.dispatch({ selection: { anchor: Math.min(v.state.selection.main.from, clamp(n)), head: clamp(n) } }); },
      contains: node => host.current?.contains(node) ?? false,
      focus: () => v.focus(), select: () => v.dispatch({ selection: { anchor: 0, head: v.state.doc.length } }),
      getBoundingClientRect: () => v.dom.getBoundingClientRect(),
    };
    handle.current = bridge;
    return () => { if (handle.current === bridge) handle.current = null; };
  }, [editing, session, handle]);
  return <div ref={host} className="canvas-markdown" onPointerDown={editing ? e => e.stopPropagation() : undefined}>
    <MarkdownView snapshot={snapshot} mode={editing ? 'live' : 'reading'} context={context}
      layout="embedded" showTitle={false} autoFocus={editing}
      onChange={(changes, version, origin) => { session.edit(version, changes, origin); return session.snapshot; }}
      onUndo={() => { session.undo(); return session.snapshot; }} onRedo={() => { session.redo(); return session.snapshot; }}
      onReady={view => { editor.current = view; unbind.current?.(); unbind.current = view ? registerEditor(view, { undo: () => session.undo(), redo: () => session.redo() }) : undefined; }} />
  </div>;
}
