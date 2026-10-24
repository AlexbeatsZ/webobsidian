import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useStore } from '../lib/store';
import { useDocumentSession } from '../lib/useDocumentSession';
import { createVaultRenderContext } from '../lib/vaultRenderContext';
import { registerEditor } from '../lib/activeEditor';
import { bindPluginEditor } from '../lib/plugins';
import { manualSave, bindTimestampUpdates } from '../lib/writing/format';
import MarkdownView from './MarkdownView';
import { analyzeMarkdown, fragmentRange, equationContext } from '@webobsidian/markdown-core';
import { nativeReviewExtension } from '../lib/review/view';
import { propertyTypesSnapshot, subscribePropertyTypes } from '../lib/propertyTypes';
import type { LinkIntent } from '../lib/fragmentNavigation';

/** Workspace adapter: rendering itself neither knows the store nor saves files. */
export default function Editor({ path: suppliedPath, reading = false, embedded = false, fragment, sidebar = false, navigationId, onOpenLink, onReady }: {
  path?: string; reading?: boolean; embedded?: boolean; fragment?: string; sidebar?: boolean;
  navigationId?: string;
  onOpenLink?: (target: string, sourcePath?: string, intent?: LinkIntent) => Promise<void>;
  onReady?: (view: import('@codemirror/view').EditorView | null) => void;
}) {
  const activePath = useStore((s) => suppliedPath ? null : s.activePath);
  const path = suppliedPath ?? activePath;
  const workspaceMode = useStore((s) => sidebar ? 'live' : s.viewMode);
  const workspaceSetMode = useStore((s) => s.setViewMode);
  const [sidebarMode, setSidebarMode] = useState<import('../lib/store').ViewMode>('live');
  const mode = sidebar ? sidebarMode : workspaceMode;
  const setMode = sidebar ? setSidebarMode : workspaceSetMode;
  const workspaceOpenLink = useStore((s) => s.openWikilink);
  const openLink = onOpenLink ?? workspaceOpenLink;
  const openMenu = useStore((s) => s.openContextMenu);
  const setLeftPanel = useStore((s) => s.setLeftPanel);
  const notify = useStore((s) => s.notify);
  const files = useStore((s) => s.filePaths);
  const propertyTypes = useSyncExternalStore(subscribePropertyTypes, propertyTypesSnapshot);
  const { session, snapshot, error } = useDocumentSession(path);
  const reviewExtensions = useMemo(() => path && !embedded && !fragment ? nativeReviewExtension(path) : [], [path, embedded, fragment]);
  useEffect(() => session && !reading ? bindTimestampUpdates(session, notify) : undefined, [session, reading, notify]);
  const [editorView, setEditorView] = useState<import('@codemirror/view').EditorView | null>(null);
  useEffect(() => {
    if (!editorView || !session) return;
    const stopEditor = registerEditor(editorView, { undo: () => session.undo(), redo: () => session.redo() });
    const stopPlugins = bindPluginEditor(editorView, path ?? '');
    return () => { stopPlugins(); stopEditor(); };
  }, [editorView, session]);
  const context = useMemo(() => ({ ...createVaultRenderContext(path ?? '', {
    bindEditor: registerEditor, openLink: (target, sourcePath, intent) => { void openLink(target, sourcePath ?? path ?? undefined, intent); }, openMenu, reportError: notify,
    files: () => [...files],
  }), navigationId: navigationId ?? (suppliedPath ? 'split' : 'main'), recordNavigation: useStore.getState().recordNavigation }), [path, openLink, openMenu, files, propertyTypes, notify, navigationId, suppliedPath]);
  const numberedContext = useMemo(() => {
    const model = session?.analysis;
    if (!model) return context;
    const from = fragment ? fragmentRange(model, fragment)?.from ?? 0 : 0;
    return { ...context, sourceFragment: !!fragment, equations: equationContext(model, from), mathSource: { model, from } };
  }, [context, session, snapshot.version, fragment]);
  if (error) return <div className="editor-error" role="alert">{error.message}</div>;
  if (!session) return <div className="editor-loading">加载中…</div>;
  const analysis = session.analysis;
  const range = fragment ? fragmentRange(analysis, fragment) : null;
  if (fragment && !range) return <div className="editor-error">未找到章节或块</div>;
  const displayed = range ? { ...snapshot, text: snapshot.text.slice(range.from, range.to), raw: snapshot.text.slice(range.from, range.to) } : snapshot;
  return <MarkdownView snapshot={displayed} documentSession={session} analysis={range ? fragmentAnalysis(analysis, range.from, range.to) : analysis} mode={reading ? 'reading' : mode} context={numberedContext}
    extensions={reviewExtensions}
    autoFocus={!reading} showTitle={!embedded} layout={embedded ? 'embedded' : 'page'}
    onChange={(changes, version, origin, model, history) => { session.edit(version, changes, origin, history); session.acceptAnalysis(model); return session.snapshot; }}
    onUndo={() => { session.undo(); return session.snapshot; }}
    onRedo={() => { session.redo(); return session.snapshot; }}
    onSave={() => { if (!reading) void manualSave(session.id).catch((cause) => notify(cause.message)); }}
    onModeChange={reading ? undefined : setMode}
    onSearch={() => setLeftPanel('search')}
    onReady={(view) => {
      setEditorView(view);
      onReady?.(view);
    }} />;
}

const fragments = new WeakMap<ReturnType<typeof analyzeMarkdown>, Map<string, ReturnType<typeof analyzeMarkdown>>>();
function fragmentAnalysis(model: ReturnType<typeof analyzeMarkdown>, from: number, to: number) {
  let cache = fragments.get(model);
  if (!cache) { cache = new Map(); fragments.set(model, cache); }
  const key = `${from}:${to}`;
  let result = cache.get(key);
  if (!result) { result = analyzeMarkdown(model.text.slice(from, to), model.id, model.version); cache.set(key, result); }
  return result;
}
