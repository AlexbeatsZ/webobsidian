import { Component, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { DocumentSession } from '@webobsidian/markdown-core';
import { equationContext } from '@webobsidian/markdown-core';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { EmbedProjection } from '../lib/embedProjection';
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
  const projection = options.edit ? new EmbedProjection(options.edit) : undefined;
  const session = options.edit?.session ?? new DocumentSession(options.id, source, undefined, async () => ({}));
  let displayedVersion = session.snapshot.version;
  let composing = false, ownWrite = false, notify: (() => void) | undefined;
  const subscribe = (listener: () => void) => {
    notify = listener;
    let version = session.snapshot.version;
    return session.subscribe(() => {
      const changed = version !== session.snapshot.version;
      version = session.snapshot.version;
      if (composing) { if (changed && !ownWrite) projection?.stop(); return; }
      listener();
    });
  };
  const getSnapshot = () => projection?.snapshot ?? session.snapshot;
  const history = (redo: boolean) => {
    if (composing || destroyed) return getSnapshot();
    if (projection) return projection.history(redo);
    if (redo) session.redo(); else session.undo();
    return session.snapshot;
  };
  const extensions = projection ? [EditorState.transactionFilter.of(transaction => {
    if (!transaction.docChanged || transaction.newDoc.toString() === projection.snapshot.text) return transaction;
    if (transaction.startState.doc.toString() !== projection.snapshot.text) return [];
    const changes: Parameters<DocumentSession['edit']>[1][number][] = [];
    transaction.changes.iterChanges((from, to, _from, _to, insert) => changes.push({ from, to, insert: insert.toString() }));
    try { projection.prepare(displayedVersion, changes); return transaction; }
    catch (error) { queueMicrotask(() => { if (!destroyed) options.context.reportError?.(String(error)); }); return []; }
  }), EditorView.domEventHandlers({
    compositionstart: () => { composing = true; },
    compositionend: () => { composing = false; queueMicrotask(() => { if (!destroyed) notify?.(); }); },
  })] : [];
  host.dataset.sourceFrom = String(options.sourceFrom ?? 0);
  function Fragment() {
    const snapshot = useSyncExternalStore(subscribe, getSnapshot);
    displayedVersion = snapshot.version;
    const callbacks = useMemo(() => ({
      onChange: (changes: Parameters<DocumentSession['edit']>[1], version: number, origin: string) => {
        if (destroyed) return getSnapshot();
        ownWrite = true;
        try { if (projection) { const next = projection.edit(version, changes, origin); displayedVersion = next.version; return next; }
          session.edit(version, changes, origin); return session.snapshot;
        } catch (error) { options.context.reportError?.(String(error)); return getSnapshot(); }
        finally { ownWrite = false; }
      },
      onUndo: () => history(false),
      onRedo: () => history(true),
    }), []);
    const context = useMemo(() => {
      const from = projection?.range?.from;
      const model = projection ? session.analysis : undefined;
      if (from !== undefined) host.dataset.sourceFrom = String(from);
      return { ...options.context, sourceFragment: true,
        equations: model && from !== undefined ? equationContext(model, from) : options.equations,
        mathSource: model && from !== undefined ? { model, from } : options.mathSource };
    }, [snapshot.version]);
    if (projection && !projection.range) return <span role="alert">找不到嵌入的章节或块</span>;
    return <div onBlurCapture={() => {
      queueMicrotask(() => {
        if (!projection && !destroyed && !host.contains(host.ownerDocument.activeElement)) options.onCommit?.(session.snapshot.raw);
      });
    }}><MarkdownView snapshot={snapshot} mode={options.mode ?? 'reading'} context={context}
      layout="embedded" showTitle={false} extensions={extensions} autoFocus={options.autoFocus} onReady={(view) => {
        if (destroyed) return;
        unbind?.(); unbind = view ? options.context.bindEditor?.(view, { undo: () => { const version = getSnapshot().version; history(false); return getSnapshot().version !== version; }, redo: () => { const version = getSnapshot().version; history(true); return getSnapshot().version !== version; } }) : undefined;
        if (view) { delete host.dataset.renderPending; options.onReady?.(); }
      }} {...callbacks} /></div>;
  }
  root.render(<FragmentBoundary onError={error => {
    if (destroyed) return;
    delete host.dataset.renderPending; host.dataset.renderError = 'fragment'; options.onError?.(error);
  }}><Fragment /></FragmentBoundary>);
  return () => {
    if (destroyed) return;
    destroyed = true; projection?.stop(); delete host.dataset.renderPending; unbind?.();
    queueMicrotask(() => root.unmount());
  };
}
