import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import { useDocumentSession } from '../lib/useDocumentSession';
import { createVaultRenderContext } from '../lib/vaultRenderContext';
import { registerEditor } from '../lib/activeEditor';
import { bindPluginEditor } from '../lib/plugins';
import { manualSave, bindTimestampUpdates } from '../lib/writing/format';
import MarkdownView from './MarkdownView';
import { analyzeMarkdown, fragmentRange, equationContext } from '@webobsidian/markdown-core';

/** Workspace adapter: rendering itself neither knows the store nor saves files. */
export default function Editor({ path: suppliedPath, reading = false, embedded = false, fragment, sidebar = false, onOpenLink, onReady }: {
  path?: string; reading?: boolean; embedded?: boolean; fragment?: string; sidebar?: boolean;
  onOpenLink?: (target: string, sourcePath?: string) => Promise<void>;
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
  const [propertyTypes, setPropertyTypes] = useState<Record<string, string>>({});
  useEffect(() => { let current = true;
    void api.propertyTypes().then((result) => { if (current) setPropertyTypes(result.types); }).catch(() => {});
    return () => { current = false; };
  }, []);
  const { session, snapshot, error } = useDocumentSession(path);
  useEffect(() => session && !reading ? bindTimestampUpdates(session, notify) : undefined, [session, reading, notify]);
  const unregister = useRef<(() => void) | undefined>(undefined);
  const context = useMemo(() => createVaultRenderContext(path ?? '', {
    bindEditor: registerEditor, openLink: (target, sourcePath) => { void openLink(target, sourcePath ?? path ?? undefined); }, openMenu, reportError: notify, initialPropertyTypes: propertyTypes,
    files: () => [...files],
  }), [path, openLink, openMenu, files, propertyTypes, notify]);
  const numberedContext = useMemo(() => {
    const model = session?.analysis;
    if (!model) return context;
    const from = fragment ? fragmentRange(model, fragment)?.from ?? 0 : 0;
    return { ...context, equations: equationContext(model, from), mathSource: { model, from } };
  }, [context, session, snapshot.version, fragment]);
  useEffect(() => {
    if (!session || reading || !snapshot.dirty || snapshot.conflict) return;
    const timer = window.setTimeout(() => { void session.save().catch((cause) => notify(cause.message)); }, 900);
    return () => window.clearTimeout(timer);
  }, [session, reading, snapshot.version, snapshot.dirty, snapshot.conflict, notify]);
  if (error) return <div className="editor-error" role="alert">{error.message}</div>;
  if (!session) return <div className="editor-loading">加载中…</div>;
  const analysis = session.analysis;
  const range = fragment ? fragmentRange(analysis, fragment) : null;
  if (fragment && !range) return <div className="editor-error">未找到章节或块</div>;
  const displayed = range ? { ...snapshot, text: snapshot.text.slice(range.from, range.to), raw: snapshot.text.slice(range.from, range.to) } : snapshot;
  return <MarkdownView snapshot={displayed} analysis={range ? fragmentAnalysis(analysis, range.from, range.to) : analysis} mode={reading ? 'reading' : mode} context={numberedContext}
    autoFocus={!reading} showTitle={!embedded} layout={embedded ? 'embedded' : 'page'}
    onChange={(changes, version, origin, model, history) => { session.edit(version, changes, origin, history); session.acceptAnalysis(model); return session.snapshot; }}
    onUndo={() => { session.undo(); return session.snapshot; }}
    onRedo={() => { session.redo(); return session.snapshot; }}
    onSave={() => { if (!reading) void manualSave(session.id).catch((cause) => notify(cause.message)); }}
    onModeChange={reading ? undefined : setMode}
    onSearch={() => setLeftPanel('search')}
    onReady={(view) => {
      unregister.current?.();
      if (view) {
        const stopEditor = registerEditor(view, { undo: () => session.undo(), redo: () => session.redo() });
        const stopPlugins = bindPluginEditor(view, path ?? '');
        unregister.current = () => { stopPlugins(); stopEditor(); };
      } else unregister.current = undefined;
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
