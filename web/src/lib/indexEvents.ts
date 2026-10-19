import { useSyncExternalStore } from 'react';

let version = 0;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
/** Called only after the server has refreshed its derived indexes. */
export function notifyIndexChanged() {
  version++;
  for (const listener of listeners) listener();
}
export function useIndexVersion() { return useSyncExternalStore(subscribe, () => version); }
