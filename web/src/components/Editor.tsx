import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../lib/store';
import { api, type TreeNode } from '../lib/api';
import { useDocumentSession } from '../lib/useDocumentSession';
import { createVaultRenderContext } from '../lib/vaultRenderContext';
import { registerEditor } from '../lib/activeEditor';
import MarkdownView from './MarkdownView';

/** Workspace adapter: rendering itself neither knows the store nor saves files. */
export default function Editor({ path: suppliedPath, reading = false }: { path?: string; reading?: boolean }) {
  const activePath = useStore((s) => s.activePath);
  const path = suppliedPath ?? activePath;
  const mode = useStore((s) => s.viewMode);
  const setMode = useStore((s) => s.setViewMode);
  const openLink = useStore((s) => s.openWikilink);
  const openMenu = useStore((s) => s.openContextMenu);
  const setLeftPanel = useStore((s) => s.setLeftPanel);
  const notify = useStore((s) => s.notify);
  const tree = useStore((s) => s.tree);
  const [propertyTypes, setPropertyTypes] = useState<Record<string, string>>({});
  useEffect(() => { let current = true;
    void api.propertyTypes().then((result) => { if (current) setPropertyTypes(result.types); }).catch(() => {});
    return () => { current = false; };
  }, []);
  const { session, snapshot, error } = useDocumentSession(path);
  const unregister = useRef<(() => void) | undefined>(undefined);
  const context = useMemo(() => createVaultRenderContext(path ?? '', {
    openLink: (target) => { void openLink(target, path ?? undefined); }, openMenu, reportError: notify, initialPropertyTypes: propertyTypes,
    files: () => {
      const files: string[] = [];
      const walk = (node: TreeNode) => { if (node.type === 'file') files.push(node.path); node.children?.forEach(walk); };
      if (tree) walk(tree);
      return files;
    },
  }), [path, openLink, openMenu, tree, propertyTypes, notify]);
  useEffect(() => {
    if (!session || reading || !snapshot.dirty || snapshot.conflict) return;
    const timer = window.setTimeout(() => { void session.save().catch((cause) => notify(cause.message)); }, 900);
    return () => window.clearTimeout(timer);
  }, [session, reading, snapshot.version, snapshot.dirty, snapshot.conflict, notify]);
  if (error) return <div className="editor-error" role="alert">{error.message}</div>;
  if (!session) return <div className="editor-loading">Loading…</div>;
  return <MarkdownView snapshot={snapshot} mode={reading ? 'reading' : mode} context={context}
    autoFocus={!reading} showTitle
    onChange={(changes, version, origin) => { session.edit(version, changes, origin); return session.snapshot; }}
    onUndo={() => { session.undo(); return session.snapshot; }}
    onRedo={() => { session.redo(); return session.snapshot; }}
    onSave={() => { if (!reading) void session.save().catch((cause) => notify(cause.message)); }}
    onModeChange={reading ? undefined : setMode}
    onSearch={() => setLeftPanel('search')}
    onReady={(view) => {
      unregister.current?.();
      unregister.current = view ? registerEditor(view, { undo: () => session.undo(), redo: () => session.redo() }) : undefined;
    }} />;
}
