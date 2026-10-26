import { useSyncExternalStore } from 'react';
import type { PdfSession } from './session';

const sessions: PdfSession[] = [];
const listeners = new Set<() => void>();
let active: PdfSession | null = null;
const notify = () => { for (const listener of listeners) listener(); };
export function activatePdfSession(session: PdfSession) {
  if (!sessions.includes(session) || session.getSnapshot().status === 'destroyed' || active === session) return;
  active = session; notify();
}
export function registerPdfSession(session: PdfSession) {
  sessions.push(session); active = session; notify();
  return () => {
    const index = sessions.indexOf(session);
    if (index === -1) return;
    sessions.splice(index, 1);
    if (active === session) active = sessions.findLast(candidate => candidate.getSnapshot().status !== 'destroyed') ?? null;
    notify();
  };
}
export const getActivePdfSession = () => active;
export const getMainPdfSession = (path: string | null) => sessions.find(session =>
  session.viewId === 'main' && session.path === path && session.getSnapshot().status !== 'destroyed') ?? null;
export function subscribeActivePdfSession(listener: () => void) {
  listeners.add(listener); return () => { listeners.delete(listener); };
}
export function useActivePdfSession() { return useSyncExternalStore(subscribeActivePdfSession, getActivePdfSession); }
export function useMainPdfSession(path: string | null) {
  return useSyncExternalStore(subscribeActivePdfSession, () => getMainPdfSession(path));
}
export function usePdfSnapshot(session: PdfSession) { return useSyncExternalStore(session.subscribe, session.getSnapshot); }
