import { useEffect, useState, useSyncExternalStore } from 'react';
import type { DocumentSession, DocumentSnapshot } from '@webobsidian/markdown-core';
import { documents } from './documents';

const empty: DocumentSnapshot = Object.freeze({ id: '', version: 0, text: '', raw: '', revision: undefined,
  dirty: false, saving: false, conflict: false });
const noSubscription = () => () => {};

export function useDocumentSession(path: string | null) {
  const [loaded, setLoaded] = useState<DocumentSession>();
  const [error, setError] = useState<Error>();
  const session = path ? documents.get(path) ?? (loaded?.id === path ? loaded : undefined) : undefined;
  useEffect(() => {
    let current = true;
    setError(undefined);
    if (path && !documents.get(path)) {
      void documents.open(path).then((doc) => { if (current) setLoaded(doc); })
        .catch((cause) => { if (current) setError(cause); });
    }
    return () => { current = false; };
  }, [path]);
  const snapshot = useSyncExternalStore(session?.subscribe ?? noSubscription,
    () => session?.snapshot ?? empty);
  return { session, snapshot, error };
}
