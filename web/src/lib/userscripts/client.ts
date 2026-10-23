import { useSyncExternalStore } from 'react';
import type { ScriptMenu, ScriptSnapshot, UserscriptBridge } from './types';

let snapshot: ScriptSnapshot | undefined;
let error = '';
let pending: Promise<void> | undefined;
let generation = 0;
const listeners = new Set<() => void>();
let unsub: (() => void) | undefined;
let refs = 0;
const emit = () => { generation++; for (const fn of listeners) fn(); };
export const userscriptSnapshot = () => snapshot;
export function subscribeUserscripts(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export const userscriptBridge = (): UserscriptBridge | undefined => (window as any).webobsidianDesktop?.userscripts;
export async function userscriptRequest<T = any>(action: string, payload?: unknown): Promise<T> {
  const bridge = userscriptBridge(); if (!bridge) throw new Error('用户脚本需要桌面版网页视图');
  return bridge.request(action, payload);
}
export function refreshUserscripts() {
  if (pending) return pending;
  return pending = userscriptRequest<ScriptSnapshot>('list').then(data => { snapshot = data; error = ''; emit(); })
    .catch(e => { error = String(e); emit(); throw e; }).finally(() => { pending = undefined; });
}
/** Mount once in App; settings and guest toolbar can also mount safely. */
export function bootstrapUserscripts() {
  if (!userscriptBridge()) return () => {};
  if (refs++ === 0) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = userscriptBridge()!.subscribe(() => {
      clearTimeout(timer); timer = setTimeout(() => void refreshUserscripts().catch(() => {}), 80);
    });
    unsub = () => { clearTimeout(timer); stop(); };
    void refreshUserscripts().catch(() => {});
  }
  return () => { if (--refs === 0) { unsub?.(); unsub = undefined; } };
}
export function useUserscripts() {
  useSyncExternalStore(subscribeUserscripts, () => generation);
  return { snapshot, error, supported: !!userscriptBridge() };
}
export function userscriptMenus() { return userscriptRequest<ScriptMenu[]>('menus'); }
