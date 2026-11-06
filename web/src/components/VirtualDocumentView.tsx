import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { fragmentRange } from '@webobsidian/markdown-core';
import { EditorView } from '@codemirror/view';
import { useStore } from '../lib/store';
import { createVaultRenderContext } from '../lib/vaultRenderContext';
import { readingWindow, type VirtualDocument, type VirtualSource } from '../lib/virtualDocuments';
import { VirtualReadingSession, registerVirtualReading, type ReadingTarget } from '../lib/virtualReading';
import { PdfSession } from '../lib/pdf/session';
import { usePdfSnapshot } from '../lib/pdf/react';
import { PageSlot } from './PdfViewer';
import MarkdownView from './MarkdownView';
import { useDocumentSession } from '../lib/useDocumentSession';
import { registerEditor } from '../lib/activeEditor';
import { bindPluginEditor } from '../lib/plugins';
import { bindTimestampUpdates, manualSave } from '../lib/writing/format';
import type { ViewMode } from '../lib/store';
import '../styles/virtual-document.css';

function VirtualTextEditor({ path, reader, mode, target, layoutVersion = 0, configuration = false }: {
  path: string; reader: VirtualReadingSession; mode: ViewMode; target?: ReadingTarget; layoutVersion?: number; configuration?: boolean;
}) {
  const { session, snapshot, error } = useDocumentSession(path, !configuration);
  const [editor, setEditor] = useState<EditorView | null>(null);
  const context = useMemo(() => ({ ...createVaultRenderContext(path, {
    bindEditor: registerEditor,
    files: () => useStore.getState().filePaths, openMenu: menu => useStore.getState().openContextMenu(menu),
    reportError: message => useStore.getState().notify(message),
    openLink: (link, source, intent) => { void useStore.getState().openWikilink(link, source, intent); },
  }), navigationId: reader.viewId }), [path, reader]);
  useEffect(() => {
    if (!editor || !session) return;
    const stop = registerEditor(editor, { undo: () => session.undo(), redo: () => session.redo() });
    const stopPlugins = configuration ? undefined : bindPluginEditor(editor, path);
    return () => { stopPlugins?.(); stop(); };
  }, [editor, session, path, configuration]);
  useEffect(() => session && !configuration && mode !== 'reading' ? bindTimestampUpdates(session, message => useStore.getState().notify(message)) : undefined,
    [session, configuration, mode]);
  useEffect(() => {
    if (!reader.getSnapshot().activeSource && !configuration && session) reader.activateSource(path);
  }, [reader, path, session, configuration]);
  useEffect(() => {
    if (!target?.fragment || !session || !editor) return;
    const range = fragmentRange(session.analysis, target.fragment);
    if (range) editor.dispatch({ selection: { anchor: range.from }, effects: EditorView.scrollIntoView(range.from, { y: 'start' }) });
  }, [target, session, editor, snapshot.version, layoutVersion]);
  if (error) return <p role="alert">{error.message}</p>;
  if (!session) return <p role="status">正在载入…</p>;
  return <div className={configuration ? 'virtual-configuration-editor' : 'virtual-text-source'} onFocusCapture={() => reader.activateSource(path)} onPointerDownCapture={() => reader.activateSource(path)}>
    {snapshot.conflict && <p role="alert">此文件存在外部修改冲突，请处理后保存。</p>}
    <MarkdownView snapshot={snapshot} documentSession={session} analysis={session.analysis} mode={mode}
      layout={configuration ? 'page' : 'embedded'} showTitle={false} context={context}
      onChange={(changes, version, origin, model, history) => { session.edit(version, changes, origin, history); session.acceptAnalysis(model); return session.snapshot; }}
      onUndo={() => { session.undo(); return session.snapshot; }} onRedo={() => { session.redo(); return session.snapshot; }}
      onSave={() => { void (configuration ? session.save() : manualSave(path)).catch(cause => useStore.getState().notify(String(cause))); }}
      onModeChange={configuration ? undefined : reader.setMode} onReady={setEditor} />
  </div>;
}

function PdfChapter({ source, reader, root, width, target, layoutVersion }: { source: VirtualSource; reader: VirtualReadingSession;
  root: RefObject<HTMLDivElement>; width: number; target?: ReadingTarget; layoutVersion: number }) {
  const session = useMemo(() => new PdfSession(source.path, 'virtual:' + reader.viewId), [source.path, reader.viewId]);
  const state = usePdfSnapshot(session);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => () => session.destroy(), [session]);
  useEffect(() => { if (state.status === 'ready') reader.outline(source.path, state.outline); }, [reader, source.path, state.status, state.outline]);
  useEffect(() => {
    if (state.status !== 'ready' || !target?.page) return;
    const frame = requestAnimationFrame(() => {
      host.current?.querySelector<HTMLElement>(`[data-page-number="${target.page}"]`)?.scrollIntoView({ block: 'start' });
      session.observePage(target.page!);
    });
    return () => cancelAnimationFrame(frame);
  }, [target, state.status, session, layoutVersion]);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    let frame = 0;
    const observe = () => {
      cancelAnimationFrame(frame); frame = requestAnimationFrame(() => {
        const slots = host.current?.querySelectorAll<HTMLElement>('[data-page-number]');
        if (!slots?.length) return;
        const bounds = host.current!.getBoundingClientRect(), viewport = element.getBoundingClientRect();
        if (bounds.bottom < viewport.top || bounds.top > viewport.bottom) return;
        const top = element.getBoundingClientRect().top + 32;
        let low = 0, high = slots.length - 1;
        while (low < high) { const middle = Math.ceil((low + high) / 2); if (slots[middle].getBoundingClientRect().top <= top) low = middle; else high = middle - 1; }
        session.observePage(Number(slots[low].dataset.pageNumber));
      });
    };
    element.addEventListener('scroll', observe, { passive: true });
    return () => { element.removeEventListener('scroll', observe); cancelAnimationFrame(frame); };
  }, [root, session, state.pageCount]);
  if (state.status === 'error') return <p role="alert">{state.error}</p>;
  return <div ref={host} className="virtual-pdf-pages">
    {state.status !== 'ready' ? <p role="status">正在打开 PDF…</p> : Array.from({ length: state.pageCount }, (_, index) =>
      <PageSlot key={index} page={index + 1} session={session} width={width} root={root} anchorWithin={host} />)}
  </div>;
}

function SourceSlot({ source, mounted, estimate, onMeasure, reader, root, width, target, layoutVersion, mode }: {
  source: VirtualSource; mounted: boolean; estimate: number; onMeasure: (height: number) => void;
  reader: VirtualReadingSession; root: RefObject<HTMLDivElement>; width: number; target?: ReadingTarget; layoutVersion: number; mode: ViewMode;
}) {
  const body = useRef<HTMLDivElement>(null), measure = useRef(onMeasure); measure.current = onMeasure;
  useLayoutEffect(() => {
    if (!mounted || !body.current) return;
    const observer = new ResizeObserver(entries => {
      if (body.current?.querySelector('[role="status"]')) return;
      const height = Math.ceil(entries[0].borderBoxSize?.[0]?.blockSize ?? body.current!.getBoundingClientRect().height);
      if (height > 0) measure.current(height);
    });
    observer.observe(body.current); return () => observer.disconnect();
  }, [mounted]);
  return <section className="virtual-source" data-virtual-source={source.path} data-mounted={mounted} style={mounted ? { minHeight: estimate } : { height: estimate }}>
    {mounted && <div ref={body} className="virtual-source-body">
      <header className="virtual-source-header"><h2>{source.title}</h2></header>
      {source.missing ? <p role="alert">来源文件已不存在：{source.path}</p> : source.kind === 'markdown'
        ? <VirtualTextEditor path={source.path} reader={reader} mode={mode} target={target} layoutVersion={layoutVersion} />
        : <PdfChapter source={source} reader={reader} root={root} width={width} target={target} layoutVersion={layoutVersion} />}
    </div>}
  </section>;
}

function ContinuousReader({ reader }: { reader: VirtualReadingSession }) {
  const state = useSyncExternalStore(reader.subscribe, reader.getSnapshot);
  const stream = reader.document.streams.find(stream => stream.id === state.stream)!;
  const root = useRef<HTMLDivElement>(null), cover = useRef<HTMLElement>(null);
  const progress = reader.progress();
  const [heights, setHeights] = useState(() => progress?.stream === stream.id && progress.heights.length === stream.files.length ? progress.heights : stream.files.map(file => file.kind === 'pdf' ? 1400 : Math.max(800, Math.min(16000, file.size / 2))));
  const heightRef = useRef(heights); heightRef.current = heights;
  const layoutVersion = useRef(0);
  const [window, setWindow] = useState({ first: 0, last: 1 });
  const [width, setWidth] = useState(760);
  const stale = useStore(state => state.vaultSessionStale);
  const navigating = useRef(false);
  const navigationIndex = useRef<number | null>(null);
  const anchor = useRef<{ index: number; offset: number } | null>(null);
  const correcting = useRef(false), correctionFrame = useRef(0), releaseFrame = useRef(0);
  const captureAnchor = () => {
    const element = root.current;
    if (!element || element.scrollTop < (cover.current?.offsetHeight ?? 0)) { anchor.current = null; return; }
    const top = element.getBoundingClientRect().top;
    const slots = element.querySelectorAll<HTMLElement>('[data-virtual-source]');
    let low = 0, high = slots.length - 1;
    while (low < high) { const middle = Math.floor((low + high) / 2); if (slots[middle].getBoundingClientRect().bottom <= top) low = middle + 1; else high = middle; }
    // A preceding chapter may grow before its ResizeObserver runs. A scroll
    // event from that layout must not replace the requested chapter with its
    // neighbour. Real user scrolling releases this navigation constraint.
    if (navigationIndex.current !== null && low !== navigationIndex.current) return;
    if (slots[low]) anchor.current = { index: low, offset: top - slots[low].getBoundingClientRect().top };
  };
  const updateWindow = () => {
    const element = root.current;
    if (!element || correcting.current) return;
    setWindow(readingWindow(heightRef.current, Math.max(0, element.scrollTop - (cover.current?.offsetHeight ?? 0)), element.clientHeight));
  };
  const restoreAnchor = () => {
    correcting.current = true;
    cancelAnimationFrame(correctionFrame.current); cancelAnimationFrame(releaseFrame.current);
    correctionFrame.current = requestAnimationFrame(() => {
      const element = root.current, current = anchor.current;
      const slot = element?.querySelectorAll<HTMLElement>('[data-virtual-source]')[current?.index ?? -1];
      if (element && current && slot) element.scrollTop += slot.getBoundingClientRect().top - element.getBoundingClientRect().top + current.offset;
      releaseFrame.current = requestAnimationFrame(() => { correcting.current = false; updateWindow(); });
    });
  };
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    if (progress?.stream === stream.id) element.scrollTop = progress.top;
    captureAnchor();
    updateWindow();
    const observer = new ResizeObserver(entries => { setWidth(Math.max(180, Math.min(900, entries[0].contentRect.width - 48))); updateWindow(); });
    observer.observe(element);
    let frame = 0;
    const scroll = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { if (!correcting.current && !navigating.current) captureAnchor(); updateWindow(); }); };
    const userScroll = () => { navigationIndex.current = null; reader.releaseTarget(); };
    element.addEventListener('scroll', scroll, { passive: true });
    for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) element.addEventListener(event, userScroll, { passive: true });
    return () => { reader.remember(stream.id, element.scrollTop, heightRef.current); observer.disconnect(); element.removeEventListener('scroll', scroll); for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) element.removeEventListener(event, userScroll); cancelAnimationFrame(frame); cancelAnimationFrame(correctionFrame.current); cancelAnimationFrame(releaseFrame.current); };
  }, [reader]);
  useLayoutEffect(() => {
    if (!state.target || !root.current) return;
    const index = stream.files.findIndex(file => file.path === state.target!.path);
    if (index < 0) return;
    navigating.current = true;
    navigationIndex.current = index;
    anchor.current = { index, offset: 0 };
    setWindow({ first: Math.max(0, index - 1), last: Math.min(stream.files.length - 1, index + 1) });
    const frame = requestAnimationFrame(() => {
      const slot = root.current?.querySelectorAll<HTMLElement>('[data-virtual-source]')[index];
      if (slot && root.current) root.current.scrollTop += slot.getBoundingClientRect().top - root.current.getBoundingClientRect().top;
      navigating.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [state.serial]);
  const measured = (index: number, height: number) => {
    const old = heightRef.current[index];
    if (Math.abs(old - height) < 2) return;
    layoutVersion.current++;
    const next = [...heightRef.current]; next[index] = height; heightRef.current = next; setHeights(next);
    if (anchor.current && index < anchor.current.index) restoreAnchor();
    else updateWindow();
  };
  if (stale) return <p role="alert">Vault 已切换，请重新加载；源文件草稿保留。</p>;
  return <div ref={root} className="virtual-document-scroll" tabIndex={0} aria-label="连续文档阅读">
    <article ref={cover} className="virtual-document-cover">
      <div className="virtual-cover-label">{reader.document.title}</div><h1>{stream.title}</h1>
      <nav aria-label="文档索引"><ol>{stream.files.map(source => <li key={source.path}><button onClick={() => reader.go({ path: source.path })}>{source.title}</button></li>)}</ol></nav>
    </article>
    {stream.files.map((source, index) => <SourceSlot key={source.path} source={source} mounted={index >= window.first && index <= window.last}
      estimate={heights[index]} onMeasure={height => measured(index, height)} reader={reader} root={root} width={width}
      layoutVersion={layoutVersion.current} mode={state.mode}
      target={state.target?.path === source.path ? state.target : undefined} />)}
  </div>;
}

export default function VirtualDocumentView({ document, viewId = 'main' }: { document: VirtualDocument; viewId?: string }) {
  const reader = useMemo(() => new VirtualReadingSession(document, viewId, useStore.getState().viewMode), [document.path, viewId]);
  useLayoutEffect(() => reader.replaceDocument(document), [reader, document]);
  useEffect(() => registerVirtualReading(reader), [reader]);
  const snapshot = useSyncExternalStore(reader.subscribe, reader.getSnapshot);
  const stream = reader.document.streams.find(stream => stream.id === snapshot.stream)!;
  const sourceIdentity = stream.files.map(file => file.path).join('\0');
  return <section className="virtual-document-view" data-virtual-document={document.path}>
    {snapshot.configuration
      ? <VirtualTextEditor path={document.path + '/.virtual-document.json'} reader={reader} mode="source" configuration />
      : <ContinuousReader key={snapshot.stream + sourceIdentity} reader={reader} />}
  </section>;
}
