import { useEffect, useRef, useState } from 'react';
import { documents } from '../lib/documents';
import { mountMarkdownFragment } from './MarkdownFragment';
import { createVaultRenderContext } from '../lib/vaultRenderContext';
import { useStore } from '../lib/store';

/** Scoped, delayed readonly preview using the existing document/renderer services. */
export default function TagPageHover({ path, x, y }: { path: string; x: number; y: number }) {
  const host = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false, dispose: (() => void) | undefined;
    const timeout = window.setTimeout(() => {
      void documents.open(path).then((session) => {
        if (cancelled || !host.current) return;
        const state = useStore.getState();
        const context = createVaultRenderContext(path, {
          openLink: (target, source) => { void state.openWikilink(target, source); },
          openMenu: (menu) => state.openContextMenu(menu), files: () => useStore.getState().filePaths,
          reportError: (message) => { if (!cancelled) setError(message); },
        });
        dispose = mountMarkdownFragment(host.current, session.snapshot.raw, {
          id: 'tag-hover:' + path, mode: 'reading',
          context: { ...context, allowHtmlExecution: false, allowPlugins: false },
        });
      }).catch((error) => { if (!cancelled) setError(String(error)); });
    }, 400);
    return () => { cancelled = true; window.clearTimeout(timeout); dispose?.(); };
  }, [path]);
  return <aside className="native-tags-hover" style={{ left: Math.max(8, Math.min(x, window.innerWidth - 456)), top: Math.max(8, Math.min(y + 12, window.innerHeight - 340)) }}>
    <strong>{path}</strong>{error && <p role="alert">{error}</p>}<div ref={host} />
  </aside>;
}
