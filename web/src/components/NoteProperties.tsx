import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useDocumentSession } from '../lib/useDocumentSession';
import { propertyTypesSnapshot, subscribePropertyTypes } from '../lib/propertyTypes';
import { createPropertyEditor, disposePropertyEditor } from '../lib/propertyEditor';
import { createVaultRenderContext } from '../lib/vaultRenderContext';
import { useStore } from '../lib/store';

export default function NoteProperties({ path }: { path: string | null }) {
  const target = path && /\.(md|markdown)$/i.test(path) ? path : null;
  const { session, snapshot, error } = useDocumentSession(target);
  const types = useSyncExternalStore(subscribePropertyTypes, propertyTypesSnapshot);
  const stale = useStore(state => state.vaultSessionStale);
  const host = useRef<HTMLDivElement>(null);
  const yaml = useMemo(() => snapshot.text.match(/^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/)?.[1] ?? '', [snapshot.text]);
  useEffect(() => {
    if (!session || !host.current) return;
    const context = createVaultRenderContext(session.id, {
      files: () => [...useStore.getState().filePaths],
      openMenu: menu => useStore.getState().openContextMenu(menu),
      openLink: (target, source, intent) => { void useStore.getState().openWikilink(target, source, intent); },
      reportError: message => useStore.getState().notify(message),
    });
    const editor = createPropertyEditor(yaml, !!snapshot.locked || stale, {
      context, text: () => session.snapshot.text,
      readOnly: () => !!session.snapshot.locked || useStore.getState().vaultSessionStale,
      apply: changes => { session.edit(session.snapshot.version, changes, 'input.properties'); },
      focus() {},
    });
    host.current.replaceChildren(editor);
    return () => { disposePropertyEditor(editor); editor.remove(); };
  }, [session, yaml, types, snapshot.locked, stale]);
  return <>
    <div className="nav-header"><span className="nav-title">属性</span></div>
    {error && <div className="panel-item" role="alert">{error.message}</div>}
    {!target && <div className="panel-item">打开 Markdown 文档查看属性</div>}
    <div ref={host} className="sidebar-body note-properties" />
  </>;
}
