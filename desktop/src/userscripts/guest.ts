import { contextBridge, ipcRenderer, webFrame } from 'electron';
import type { ScriptRecord } from '../../../web/src/lib/userscripts/types';
import { injectionSource } from './runtime';

/** Invoked only by the app-owned sandboxed guest preload, never a remote page. */
export function installGuestUserscripts() {
  if (!process.isMainFrame || !/^https?:$/.test(location.protocol)) return;
  const installed = new Map<string, { world: number; slot: string }>();
  let documentToken = '', sequence = 1000, disposed = false;
  let snapshot: { token: string; scripts: ScriptRecord[]; values: Record<string, Record<string, unknown>>; error?: string };
  const report = (scriptId: string | undefined, state: string, message?: string) => ipcRenderer.send('userscripts:status', { scriptId, state, message });
  const read = () => {
    snapshot = ipcRenderer.sendSync('userscripts:initial');
    if (snapshot.error) { report(undefined, 'error', snapshot.error); return false; }
    documentToken = snapshot.token; return true;
  };
  const execute = (world: number, code: string) => world === 0 ? webFrame.executeJavaScript(code) : webFrame.executeJavaScriptInIsolatedWorld(world, [{ code }]);
  const run = (phase: string) => {
    if (disposed || !snapshot?.scripts) return;
    for (const script of snapshot.scripts) {
      if (installed.has(script.id) || (script.metadata.runAt !== phase && phase !== 'late')) continue;
      const page = !script.metadata.grants.length || script.metadata.grants.includes('none') || script.metadata.grants.includes('unsafeWindow');
      const world = page ? 0 : ++sequence;
      const key = '__wo_us_' + crypto.randomUUID().replace(/-/g, '');
      const slot = key + '_runtime';
      const api = {
        world: page ? 'page' : 'isolated',
        request: (action: string, payload: unknown) => ipcRenderer.invoke('userscripts:guest-op', { token: documentToken, scriptId: script.id, revision: script.revision, action, payload }),
        report: (message: string) => report(script.id, 'error', message),
      };
      try {
        if (world === 0) contextBridge.exposeInMainWorld(key, api);
        else contextBridge.exposeInIsolatedWorld(world, key, api);
        installed.set(script.id, { world, slot });
        // Electron 33 webFrame executes synchronously unless the frame is suspended.
        void execute(world, injectionSource(script, snapshot.values[script.id] ?? {}, key, slot)).then(result => {
          report(script.id, result?.ok ? 'running' : 'error', result?.error || (result?.ok ? undefined : 'Guest execution returned no result'));
        }).catch(e => report(script.id, 'error', String(e)));
      } catch (e) { report(script.id, 'error', String(e)); }
    }
  };
  if (!read()) return;
  run('document-start');
  const body = new MutationObserver(() => { if (document.body) { body.disconnect(); run('document-body'); } });
  if (document.body) run('document-body'); else body.observe(document, { childList: true, subtree: true });
  const ready = () => { run('document-body'); run('document-end'); setTimeout(() => run('document-idle'), 0); };
  if (document.readyState !== 'loading') ready(); else document.addEventListener('DOMContentLoaded', ready, { once: true });
  const page = () => { if (read()) { run('document-start'); if (document.body) run('document-body'); if (document.readyState !== 'loading') ready(); } };
  const menu = (_event: unknown, payload: { token: string; scriptId: string; id: string }) => {
    const target = installed.get(payload.scriptId);
    if (payload.token !== documentToken || !target) return;
    void execute(target.world, `globalThis[${JSON.stringify(target.slot)}]?.invoke(${JSON.stringify(payload.id)})`).catch(e => report(payload.scriptId, 'error', String(e)));
  };
  const values = (_event: unknown, payload: { scriptId: string; patch: Record<string, unknown>; deleted: string[] }) => {
    const target = installed.get(payload.scriptId); if (!target) return;
    void execute(target.world, `globalThis[${JSON.stringify(target.slot)}]?.remote(${JSON.stringify(payload.patch)},${JSON.stringify(payload.deleted)})`).catch(e => report(payload.scriptId, 'error', String(e)));
  };
  ipcRenderer.on('userscripts:page', page);
  ipcRenderer.on('userscripts:menu', menu);
  ipcRenderer.on('userscripts:values', values);
  window.addEventListener('pageshow', event => { if (event.persisted) { disposed = false; page(); } });
  window.addEventListener('pagehide', event => {
    disposed = true; body.disconnect();
    if (event.persisted) return; // BFCache restores this world and its cached values.
    ipcRenderer.removeListener('userscripts:page', page); ipcRenderer.removeListener('userscripts:menu', menu); ipcRenderer.removeListener('userscripts:values', values);
  });
}
