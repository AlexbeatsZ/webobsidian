import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { DocumentSession, fragmentRange } from '@webobsidian/markdown-core';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { useStore } from '../lib/store';
import { createVaultRenderContext } from '../lib/vaultRenderContext';
import { readingWindow, type VirtualDocument, type VirtualSource } from '../lib/virtualDocuments';
import { VirtualReadingSession, registerVirtualReading, type ReadingTarget } from '../lib/virtualReading';
import { PdfSession } from '../lib/pdf/session';
import { registerPdfSession, usePdfSnapshot } from '../lib/pdf/react';
import { PageSlot } from './PdfViewer';
import MarkdownView from './MarkdownView';
import { useDocumentSession } from '../lib/useDocumentSession';
import { registerEditor } from '../lib/activeEditor';
import { bindPluginEditor } from '../lib/plugins';
import { bindTimestampUpdates, manualSave } from '../lib/writing/format';
import type { ViewMode } from '../lib/store';
import { documents } from '../lib/documents';
import { applyEdits, modify } from 'jsonc-parser';
import type { RenderContext } from '../lib/renderContext';
import '../styles/virtual-document.css';

function renameSource(reader: VirtualReadingSession, path: string) {
  return async (value: string) => {
    const title = value.trim();
    if (!title || title === '.' || title === '..' || /[\/#<>:"\\|?*\u0000-\u001f]/.test(title) || /[. ]$/.test(title))
      throw new Error('请输入有效的笔记标题，不能包含 #、斜杠或文件名保留字符');
    const configuration = documents.get(reader.document.path + '/.virtual-document.json')?.snapshot;
    if (configuration?.dirty || configuration?.saving || configuration?.conflict)
      throw new Error('请先保存或处理连续文档配置中的修改，再重命名来源');
    const to = path.slice(0, path.lastIndexOf('/') + 1) + title + path.slice(path.lastIndexOf('.'));
    await useStore.getState().renamePath(path, to, undefined, { path: reader.document.path, revision: reader.document.revision });
    reader.go({ path: to });
  };
}

const markdownText = (value: string) => value.replace(/[\\`*_[\]<>#]/g, '\\$&').replace(/[\r\n]/g, ' ');
const generatedServices: Pick<RenderContext, 'openMenu' | 'rawUrl' | 'files' | 'tags' | 'properties' | 'propertyTypes' | 'setPropertyType' | 'renderEmbed'> = {
  openMenu: menu => useStore.getState().openContextMenu(menu), rawUrl: target => target, files: () => [], tags: async () => [],
  properties: async () => [], propertyTypes: () => ({}), setPropertyType: async () => ({}), renderEmbed: async () => null,
};
function CoverIndex({ reader, stream }: { reader: VirtualReadingSession; stream: VirtualDocument['streams'][number] }) {
  const content = '# ' + markdownText(stream.title) + '\n\n' + stream.files.map((source, index) =>
    `${index + 1}. [${markdownText(source.title)}](<${encodeURI(source.path).replace(/[()]/g, char => '%' + char.charCodeAt(0).toString(16))}>)`).join('\n') + '\n';
  const session = useMemo(() => new DocumentSession(reader.document.path + '/.virtual-document-index.md', content, undefined, async () => ({})), [reader, content]);
  const context = useMemo(() => ({
    ...generatedServices,
    sourcePath: session.id, navigationId: reader.viewId,
    openLink: (target: string) => {
      let path = target;
      try { path = decodeURIComponent(target); } catch { /* literal link */ }
      if (stream.files.some(source => source.path === path)) reader.go({ path });
    },
    reportError: (message: string) => useStore.getState().notify(message),
    renameTitle: async (value: string) => {
      const title = value.trim();
      if (!title || title.length > 200 || /[\r\n]/.test(title)) throw new Error('文档标题需要 1–200 个字符');
      const lease = await documents.acquire(reader.document.path + '/.virtual-document.json');
      try {
        const snapshot = lease.session.snapshot;
        if (snapshot.dirty || snapshot.saving || snapshot.conflict) throw new Error('请先保存或处理连续文档配置中的修改');
        const bom = snapshot.raw.startsWith('\ufeff') ? '\ufeff' : '', content = snapshot.raw.slice(bom.length);
        lease.session.setRawText(bom + applyEdits(content, modify(content, ['title'], title, {})));
        await lease.session.save();
        await useStore.getState().loadTree();
      } finally { lease.release(); }
    },
  }), [reader, session, stream]);
  return <nav aria-label="文档索引"><MarkdownView snapshot={session.snapshot} documentSession={session} analysis={session.analysis}
    mode="reading" layout="embedded" title={reader.document.title} context={context} /></nav>;
}

interface EditorLayoutScroll { read: () => number; commit: (before: number) => void }
function VirtualTextEditor({ path, reader, mode, target, layoutVersion = 0, configuration = false, layoutScroll }: {
  path: string; reader: VirtualReadingSession; mode: ViewMode; target?: ReadingTarget; layoutVersion?: number; configuration?: boolean;
  layoutScroll?: EditorLayoutScroll;
}) {
  const { session, snapshot, error } = useDocumentSession(path, !configuration);
  const [editor, setEditor] = useState<EditorView | null>(null);
  const scrollLifecycle = useRef(layoutScroll); scrollLifecycle.current = layoutScroll;
  const layoutExtensions = useMemo(() => configuration ? [] : [ViewPlugin.fromClass(class {
    disposed = false;
    before: number | undefined;
    queued = false;
    constructor(view: EditorView) { this.measure(view); }
    measure(view: EditorView) {
      view.requestMeasure({ key: this,
        read: () => this.before ??= scrollLifecycle.current?.read() ?? 0,
        // CM may adjust an ancestor scroll container after measure writes.
        // Observe the completed synchronous measure before the next input.
        write: () => {
          if (this.queued) return;
          this.queued = true;
          queueMicrotask(() => {
            const before = this.before;
            this.before = undefined; this.queued = false;
            if (!this.disposed && before !== undefined) scrollLifecycle.current?.commit(before);
          });
        },
      });
    }
    update(update: ViewUpdate) { if (update.geometryChanged) this.measure(update.view); }
    docViewUpdate(view: EditorView) { this.measure(view); }
    destroy() { this.disposed = true; }
  })], [configuration]);
  const context = useMemo(() => ({ ...createVaultRenderContext(path, {
    bindEditor: registerEditor,
    files: () => useStore.getState().filePaths, openMenu: menu => useStore.getState().openContextMenu(menu),
    reportError: message => useStore.getState().notify(message),
    openLink: (link, source, intent) => { void useStore.getState().openWikilink(link, source, intent); },
  }), navigationId: reader.viewId,
    renameTitle: !configuration && session && !snapshot.locked ? renameSource(reader, session.id) : undefined,
  }), [path, reader, configuration, session, snapshot.locked]);
  useEffect(() => {
    if (!editor || !session) return;
    const stop = registerEditor(editor, { undo: () => session.undo(), redo: () => session.redo() });
    const stopPlugins = configuration ? undefined : bindPluginEditor(editor, path);
    return () => { stopPlugins?.(); stop(); };
  }, [editor, session, path, configuration]);
  useEffect(() => session && !configuration && mode !== 'reading' ? bindTimestampUpdates(session, message => useStore.getState().notify(message)) : undefined,
    [session, configuration, mode]);
  useEffect(() => {
    if (!target || !session || !editor) return;
    const range = target.fragment ? fragmentRange(session.analysis, target.fragment) : undefined;
    const from = range?.from ?? (target.line !== undefined ? editor.state.doc.line(Math.min(editor.state.doc.lines, Math.max(1, target.line + 1))).from : undefined);
    if (from !== undefined) editor.dispatch({ selection: { anchor: from }, effects: EditorView.scrollIntoView(from, { y: 'start' }) });
  }, [target, session, editor, snapshot.version, layoutVersion]);
  if (error) return <p role="alert">{error.message}</p>;
  if (!session) return <p role="status" data-virtual-loading>正在载入…</p>;
  return <div className={configuration ? 'virtual-configuration-editor' : 'virtual-text-source'} data-virtual-loading={editor ? undefined : true}
    onFocusCapture={() => reader.activateSource(path)} onPointerDownCapture={() => reader.activateSource(path)}>
    {snapshot.conflict && <p role="alert">此文件存在外部修改冲突，请处理后保存。</p>}
    <MarkdownView snapshot={snapshot} documentSession={session} analysis={session.analysis} mode={mode}
      layout={configuration ? 'page' : 'embedded'} showTitle={!configuration} context={context} extensions={layoutExtensions}
      onChange={(changes, version, origin, model, history) => { session.edit(version, changes, origin, history); session.acceptAnalysis(model); return session.snapshot; }}
      onUndo={() => { session.undo(); return session.snapshot; }} onRedo={() => { session.redo(); return session.snapshot; }}
      onSave={() => { void (configuration ? session.save() : manualSave(path)).catch(cause => useStore.getState().notify(String(cause))); }}
      onModeChange={configuration ? undefined : reader.setMode} onReady={setEditor} />
  </div>;
}

function PdfChapter({ source, reader, root, width, target, layoutVersion, onLayoutScroll }: { source: VirtualSource; reader: VirtualReadingSession;
  root: RefObject<HTMLDivElement>; width: number; target?: ReadingTarget; layoutVersion: number; onLayoutScroll: (delta: number) => void }) {
  const session = useMemo(() => new PdfSession(source.path, 'virtual:' + reader.viewId), [source.path, reader.viewId]);
  const state = usePdfSnapshot(session);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => registerPdfSession(session), [session]);
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
    {state.status !== 'ready' ? <p role="status" data-virtual-loading>正在打开 PDF…</p> : Array.from({ length: state.pageCount }, (_, index) =>
      <PageSlot key={index} page={index + 1} session={session} width={width} root={root} anchorWithin={host} onLayoutScroll={onLayoutScroll} />)}
  </div>;
}

function SourceSlot({ source, mounted, estimate, onMeasure, reader, root, width, target, layoutVersion, mode, onLayoutScroll, editorLayoutScroll }: {
  source: VirtualSource; mounted: boolean; estimate: number; onMeasure: (height: number) => void;
  reader: VirtualReadingSession; root: RefObject<HTMLDivElement>; width: number; target?: ReadingTarget; layoutVersion: number; mode: ViewMode;
  onLayoutScroll: (delta: number) => void;
  editorLayoutScroll: EditorLayoutScroll;
}) {
  const body = useRef<HTMLDivElement>(null), measure = useRef(onMeasure); measure.current = onMeasure;
  useLayoutEffect(() => {
    if (!mounted || !body.current) return;
    const measureBody = () => {
      if (!body.current || body.current.querySelector('[data-virtual-loading]')) return;
      // Formula/chart widgets have independent status nodes. They must never
      // suspend measurement of an otherwise loaded, virtualized chapter.
      const height = Math.ceil(body.current.getBoundingClientRect().height)
        + (parseFloat(getComputedStyle(body.current!.parentElement!).borderTopWidth) || 0);
      if (height > 0) measure.current(height);
    };
    const observer = new ResizeObserver(measureBody);
    // The loader can disappear without changing the estimated outer height.
    // Observe only its replacement, rather than every formula's SVG mutations.
    const loaded = new MutationObserver(() => {
      if (!body.current || body.current.querySelector('[data-virtual-loading]')) return;
      measureBody();
      loaded.disconnect();
    });
    observer.observe(body.current);
    if (body.current.querySelector('[data-virtual-loading]')) loaded.observe(body.current, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['data-virtual-loading'],
    });
    measureBody();
    return () => { observer.disconnect(); loaded.disconnect(); };
  }, [mounted]);
  return <section className="virtual-source" data-virtual-source={source.path} data-mounted={mounted} style={mounted ? { minHeight: estimate } : { height: estimate }}>
    {mounted && <div ref={body} className="virtual-source-body">
      {source.kind === 'pdf' && <SourceTitle source={source} reader={reader} />}
      {source.missing ? <p role="alert">来源文件已不存在：{source.path}</p> : source.kind === 'markdown'
        ? <VirtualTextEditor path={source.path} reader={reader} mode={mode} target={target} layoutVersion={layoutVersion} layoutScroll={editorLayoutScroll} />
        : <PdfChapter source={source} reader={reader} root={root} width={width} target={target} layoutVersion={layoutVersion} onLayoutScroll={onLayoutScroll} />}
    </div>}
  </section>;
}

function SourceTitle({ source, reader }: { source: VirtualSource; reader: VirtualReadingSession }) {
  const [ready, setReady] = useState(false);
  const session = useMemo(() => new DocumentSession(source.path, '', undefined, async () => ({})), [source.path]);
  const context = useMemo(() => ({ ...generatedServices, sourcePath: source.path, openLink: () => {}, renameTitle: renameSource(reader, source.path),
    reportError: (message: string) => useStore.getState().notify(message) }), [source.path, reader]);
  return <header className="virtual-source-header" data-virtual-loading={ready ? undefined : true}><MarkdownView snapshot={session.snapshot} mode="reading"
    layout="embedded" title={source.title} context={context} onReady={view => setReady(!!view)} /></header>;
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
  const observedTop = useRef(0);
  const correcting = useRef(false), correctionFrame = useRef(0), releaseFrame = useRef(0), navigationFrame = useRef(0);
  const noteScrollDelta = () => {
    const element = root.current;
    if (!element) return;
    // A correction may be waiting when the next wheel/touch event is delivered.
    // Move the logical anchor by that real scroll delta before restoring layout.
    if (anchor.current && navigationIndex.current === null) anchor.current.offset += element.scrollTop - observedTop.current;
    observedTop.current = element.scrollTop;
  };
  const captureAnchor = () => {
    const element = root.current;
    if (!element) return;
    noteScrollDelta();
    // Until a real input releases navigation, only the requested source owns
    // the anchor. A transient DOM position must not rewrite its offset either.
    if (navigationIndex.current !== null) return;
    if (element.scrollTop < (cover.current?.offsetHeight ?? 0)) {
      anchor.current = null;
      reader.activateSource(undefined);
      return;
    }
    const top = element.getBoundingClientRect().top;
    const slots = element.querySelectorAll<HTMLElement>('[data-virtual-source]');
    // ResizeObserver runs after layout. Until its measurements have committed,
    // the DOM can already show a different chapter at the top while scrollTop
    // has not moved at all. Keep the previous identity through that interval.
    for (let index = 0; index < slots.length; index++) {
      const body = slots[index].firstElementChild as HTMLElement | null;
      if (!body || body.querySelector('[data-virtual-loading]')) continue;
      const border = parseFloat(getComputedStyle(slots[index]).borderTopWidth) || 0;
      if (Math.abs(body.getBoundingClientRect().height + border - heightRef.current[index]) > 2) return;
    }
    let low = 0, high = slots.length - 1;
    while (low < high) { const middle = Math.floor((low + high) / 2); if (slots[middle].getBoundingClientRect().bottom <= top) low = middle + 1; else high = middle; }
    // A preceding chapter may grow before its ResizeObserver runs. A scroll
    // event from that layout must not replace the requested chapter with its
    // neighbour. Real user scrolling releases this navigation constraint.
    if (navigationIndex.current !== null && low !== navigationIndex.current) return;
    const visible = low;
    // At a file boundary keep its next title as the anchor. In particular, an
    // unresolved predecessor has no text position to anchor inside yet.
    if (slots[low + 1] && (slots[low].querySelector('[data-virtual-loading]') || slots[low + 1].getBoundingClientRect().top < top + element.clientHeight)) low++;
    if (slots[low]) anchor.current = { index: low, offset: top - slots[low].getBoundingClientRect().top };
    if (stream.files[visible]) reader.activateSource(stream.files[visible].path);
  };
  const updateWindow = () => {
    const element = root.current;
    // Navigation already mounts the target and both neighbours. Recomputing
    // from an expanded DOM and an as-yet unmeasured height table can evict the
    // predecessor and clamp scrollTop before its correction has committed.
    if (!element || correcting.current || navigationIndex.current !== null) return;
    setWindow(readingWindow(heightRef.current, Math.max(0, element.scrollTop - (cover.current?.offsetHeight ?? 0)), element.clientHeight));
  };
  const restoreAnchor = () => {
    correcting.current = true;
    cancelAnimationFrame(correctionFrame.current); cancelAnimationFrame(releaseFrame.current);
    correctionFrame.current = requestAnimationFrame(() => {
      noteScrollDelta();
      const element = root.current, current = anchor.current;
      const slot = element?.querySelectorAll<HTMLElement>('[data-virtual-source]')[current?.index ?? -1];
      if (element && current && slot) {
        element.scrollTop += slot.getBoundingClientRect().top - element.getBoundingClientRect().top + current.offset;
        observedTop.current = element.scrollTop;
      }
      releaseFrame.current = requestAnimationFrame(() => { correcting.current = false; captureAnchor(); updateWindow(); });
    });
  };
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    if (progress?.stream === stream.id) element.scrollTop = progress.top;
    observedTop.current = element.scrollTop;
    captureAnchor();
    updateWindow();
    const observer = new ResizeObserver(entries => { setWidth(Math.max(180, Math.min(900, entries[0].contentRect.width - 48))); updateWindow(); });
    observer.observe(element);
    let frame = 0;
    const scroll = () => {
      noteScrollDelta();
      cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { if (!correcting.current && !navigating.current) captureAnchor(); updateWindow(); });
    };
    const userScroll = () => {
      cancelAnimationFrame(navigationFrame.current);
      navigating.current = false;
      navigationIndex.current = null;
      reader.releaseTarget();
    };
    element.addEventListener('scroll', scroll, { passive: true });
    for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) element.addEventListener(event, userScroll, { passive: true });
    return () => { reader.remember(stream.id, element.scrollTop, heightRef.current); observer.disconnect(); element.removeEventListener('scroll', scroll); for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) element.removeEventListener(event, userScroll); cancelAnimationFrame(frame); cancelAnimationFrame(correctionFrame.current); cancelAnimationFrame(releaseFrame.current); cancelAnimationFrame(navigationFrame.current); };
  }, [reader]);
  useLayoutEffect(() => {
    if (!state.target || !root.current) return;
    if (state.target.path === reader.document.path) {
      cancelAnimationFrame(correctionFrame.current); cancelAnimationFrame(releaseFrame.current);
      navigating.current = false; correcting.current = false; navigationIndex.current = null; anchor.current = null;
      root.current.scrollTop = 0; observedTop.current = root.current.scrollTop;
      setWindow({ first: 0, last: Math.min(1, stream.files.length - 1) });
      return;
    }
    const index = stream.files.findIndex(file => file.path === state.target!.path);
    if (index < 0) return;
    navigating.current = true;
    navigationIndex.current = index;
    anchor.current = { index, offset: 0 };
    observedTop.current = root.current.scrollTop;
    setWindow({ first: Math.max(0, index - 1), last: Math.min(stream.files.length - 1, index + 1) });
    navigationFrame.current = requestAnimationFrame(() => {
      const slot = root.current?.querySelectorAll<HTMLElement>('[data-virtual-source]')[index];
      if (slot && root.current) {
        root.current.scrollTop += slot.getBoundingClientRect().top - root.current.getBoundingClientRect().top;
        observedTop.current = root.current.scrollTop;
      }
      navigating.current = false;
    });
    return () => cancelAnimationFrame(navigationFrame.current);
  }, [state.serial]);
  const measured = (index: number, height: number) => {
    const old = heightRef.current[index];
    if (Math.abs(old - height) < 2) return;
    noteScrollDelta();
    layoutVersion.current++;
    const next = [...heightRef.current]; next[index] = height; heightRef.current = next; setHeights(next);
    if (anchor.current && index < anchor.current.index) restoreAnchor();
    else updateWindow();
  };
  const pageLayoutScroll = (index: number, delta: number) => {
    // A predecessor PDF's full height is already handled by restoreAnchor.
    // While seeking, the requested source/page remains the only scroll owner.
    // Otherwise preserve a page within the current PDF without treating its
    // own layout compensation as fresh wheel/touch input.
    if (!root.current || !anchor.current || anchor.current.index !== index || navigationIndex.current !== null) return;
    noteScrollDelta();
    const before = root.current.scrollTop;
    root.current.scrollTop += delta;
    anchor.current.offset += root.current.scrollTop - before;
    observedTop.current = root.current.scrollTop;
  };
  const editorLayoutRead = () => {
    noteScrollDelta();
    return root.current?.scrollTop ?? 0;
  };
  const editorLayoutCommit = (index: number, before: number) => {
    const element = root.current, current = anchor.current;
    if (!element || !current) return;
    const delta = element.scrollTop - before;
    if (Math.abs(delta) < 0.01) return;
    observedTop.current = element.scrollTop;
    const target = reader.getSnapshot().target;
    if (current.index === index && navigationIndex.current === null) current.offset += delta;
    else if (current.index === index && target && (target.fragment || target.line !== undefined)) {
      const slot = element.querySelectorAll<HTMLElement>('[data-virtual-source]')[index];
      if (slot) current.offset = element.getBoundingClientRect().top - slot.getBoundingClientRect().top;
    } else restoreAnchor();
  };
  if (stale) return <p role="alert">Vault 已切换，请重新加载；源文件草稿保留。</p>;
  return <div ref={root} className="virtual-document-scroll" tabIndex={0} aria-label="连续文档阅读">
    <article ref={cover} className="virtual-document-cover">
      <CoverIndex reader={reader} stream={stream} />
    </article>
    {stream.files.map((source, index) => <SourceSlot key={source.path} source={source} mounted={index >= window.first && index <= window.last}
      estimate={heights[index]} onMeasure={height => measured(index, height)} reader={reader} root={root} width={width}
      onLayoutScroll={delta => pageLayoutScroll(index, delta)}
      editorLayoutScroll={{ read: editorLayoutRead, commit: before => editorLayoutCommit(index, before) }}
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
