import { useSyncExternalStore } from 'react';
import { getActiveNavigationId, subscribeActiveNavigation } from './activeEditor';
import { useStore } from './store';

/** Page-dependent panels follow the same transient identity as command dispatch. */
export function useActivePage() {
  useSyncExternalStore(subscribeActiveNavigation, getActiveNavigationId);
  const viewId = useStore(state => state.currentViewId());
  const path = useStore(state => state.currentPath(viewId));
  return { path, viewId };
}
