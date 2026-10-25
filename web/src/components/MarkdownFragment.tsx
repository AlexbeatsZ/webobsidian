import { Component, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { DocumentSession } from '@webobsidian/markdown-core';
import MarkdownView from './MarkdownView';
import type { FragmentOptions, RenderContext } from '../lib/renderContext';

class FragmentBoundary extends Component<{ onError: (error: Error) => void; children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { this.props.onError(error); }
  render() { return this.state.error ? <span role="alert">{this.state.error.message}</span> : this.props.children; }
}

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
    const context = useMemo(() => ({ ...options.context, sourceFragment: true, equations: options.equations, mathSource: options.mathSource }), []);
    return <div onBlurCapture={() => {
      queueMicrotask(() => {
        if (!destroyed && !host.contains(host.ownerDocument.activeElement)) options.onCommit?.(session.snapshot.raw);
      });
    }}><MarkdownView snapshot={snapshot} mode={options.mode ?? 'reading'} context={context}
      layout="embedded" showTitle={false} autoFocus={options.autoFocus} onReady={(view) => {
        if (destroyed) return;
        unbind?.(); unbind = view ? options.context.bindEditor?.(view, { undo: () => session.undo(), redo: () => session.redo() }) : undefined;
        if (view) { delete host.dataset.renderPending; options.onReady?.(); }
      }} {...callbacks} /></div>;
  }
  root.render(<FragmentBoundary onError={error => {
    if (destroyed) return;
    delete host.dataset.renderPending; host.dataset.renderError = 'fragment'; options.onError?.(error);
  }}><Fragment /></FragmentBoundary>);
  return () => {
    if (destroyed) return;
    destroyed = true; delete host.dataset.renderPending; unbind?.();
    queueMicrotask(() => root.unmount());
  };
}
