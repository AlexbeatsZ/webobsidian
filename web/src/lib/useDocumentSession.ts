import { useEffect, useState, useSyncExternalStore } from 'react';
import type { DocumentSession, DocumentSnapshot } from '@webobsidian/markdown-core';
import { documents } from './documents';

const empty: DocumentSnapshot = Object.freeze({ id: '', version: 0, text: '', raw: '', revision: undefined,
  dirty: false, saving: false, conflict: false });
const noSubscription = () => () => {};

export function useDocumentSession(path: string | null, transient = false) {
  const [loaded, setLoaded] = useState<DocumentSession>();
  const [error, setError] = useState<Error>();
  const session = path ? documents.get(path) ?? (loaded?.id === path ? loaded : undefined) : undefined;
  useEffect(() => {
    let current = true;
    let release: (() => void) | undefined;
    setError(undefined);
    if (path && transient) {
      void documents.acquire(path).then(lease => { if (current) { release = lease.release; setLoaded(lease.session); } else lease.release(); })
        .catch((cause) => { if (current) setError(cause); });
    } else if (path) {
      const existing = documents.get(path);
      if (existing) documents.pin(existing);
      else void documents.open(path).then(doc => { if (current) setLoaded(doc); }).catch(cause => { if (current) setError(cause); });
    }
    return () => { current = false; release?.(); };
  }, [path, transient]);
  const snapshot = useSyncExternalStore(session?.subscribe ?? noSubscription,
    () => session?.snapshot ?? empty);
  return { session, snapshot, error };
}

/** Status indicators observe an existing session without loading or pinning it. */
export function useExistingDocumentSnapshot(path: string | null) {
  return useSyncExternalStore(listener => documents.subscribe(snapshot => { if (snapshot.id === path) listener(); }),
    () => path ? documents.get(path)?.snapshot ?? empty : empty);
}
