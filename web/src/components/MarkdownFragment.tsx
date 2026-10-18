import { useMemo, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { DocumentSession } from '@webobsidian/markdown-core';
import MarkdownView from './MarkdownView';
import type { FragmentOptions, RenderContext } from '../lib/renderContext';

/** The same engine in a small host. A cell owns a local draft until focus leaves. */
export function mountMarkdownFragment(host: HTMLElement, source: string, options: FragmentOptions & { context: RenderContext }): () => void {
  host.dataset.renderPending = 'true';
  const root = createRoot(host);
  let destroyed = false;
  let unbind: (() => void) | undefined;
  const session = new DocumentSession(options.id, source, undefined, async () => ({}));
  host.dataset.sourceFrom = String(options.sourceFrom ?? 0);
  function Fragment() {
    const snapshot = useSyncExternalStore(session.subscribe, () => session.snapshot);
    const callbacks = useMemo(() => ({
      onChange: (changes: Parameters<DocumentSession['edit']>[1], version: number, origin: string) => {
        session.edit(version, changes, origin); return session.snapshot;
      },
      onUndo: () => { session.undo(); return session.snapshot; },
      onRedo: () => { session.redo(); return session.snapshot; },
    }), []);
    return <div onBlurCapture={() => {
      queueMicrotask(() => {
        if (!destroyed && !host.contains(document.activeElement)) options.onCommit?.(session.snapshot.raw);
      });
    }}><MarkdownView snapshot={snapshot} mode={options.mode ?? 'reading'} context={options.context}
      layout="embedded" showTitle={false} autoFocus={options.autoFocus} onReady={(view) => {
        unbind?.(); unbind = view ? options.context.bindEditor?.(view, { undo: () => session.undo(), redo: () => session.redo() }) : undefined;
        if (view) { delete host.dataset.renderPending; options.onReady?.(); }
      }} {...callbacks} /></div>;
  }
  root.render(<Fragment />);
  return () => { destroyed = true; unbind?.(); queueMicrotask(() => root.unmount()); };
}
