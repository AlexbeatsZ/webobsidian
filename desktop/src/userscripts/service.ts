import { app, clipboard, ipcMain, Notification, shell, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { GuestStatus, ScriptMenu, ScriptRecord } from '../../../web/src/lib/userscripts/types';
import { matches, needsApproval, connectAllowed, identity } from './metadata';
import { approval, prepareBundle, UserscriptStore } from './store';
import { scriptFetch } from './network';
import { UserscriptUpdater } from './updater';

type IpcEvent = IpcMainEvent | IpcMainInvokeEvent;
interface Guest {
  contents: WebContents; token: string; scripts: Map<string, ScriptRecord>;
  menus: Map<string, ScriptMenu>; requests: Map<string, AbortController>;
}
const string = (v: unknown, limit = 8192) => { if (typeof v !== 'string' || v.length > limit) throw new Error('Invalid string argument'); return v; };
const object = (v: unknown): Record<string, any> => { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Object argument required'); return v; };
const bool = (v: unknown) => { if (typeof v !== 'boolean') throw new Error('Boolean argument required'); return v; };

/** Desktop-only bridge. Host and guest IPC have distinct sender checks and channels. */
export class UserscriptService {
  private store?: UserscriptStore;
  private updater?: UserscriptUpdater;
  private guests = new Map<number, Guest>();
  private statuses: GuestStatus[] = [];
  private error?: string;
  private switching?: Promise<void>;
  private stopped = false;
  private imports = new AbortController();
  private operations = new Set<Promise<unknown>>();
  constructor(private options: {
    dataDir: string; fallbackVault: string; window: () => BrowserWindow | null;
    hostAllowed: (event: IpcEvent) => boolean;
  }) {}
  private changed = () => { const w = this.options.window(); if (w && !w.isDestroyed()) w.webContents.send('userscripts:changed'); };
  async start() {
    await this.refreshVault();
    ipcMain.handle('userscripts:manage', this.manage);
    ipcMain.on('userscripts:initial', this.initial);
    ipcMain.handle('userscripts:guest-op', this.guestOperation);
    ipcMain.on('userscripts:status', this.status);
    app.on('web-contents-created', this.created);
  }
  private created = (_event: Electron.Event, contents: WebContents) => {
    // Enroll before the first preload runs; did-attach-webview repeats this safely.
    if (contents.getType() === 'webview' && contents.hostWebContents === this.options.window()?.webContents) this.attach(contents);
  };
  private refreshVault() {
    if (this.switching) return this.switching;
    return this.switching = (async () => {
      try {
        let vault = this.options.fallbackVault;
        try { const settings = JSON.parse(await fs.readFile(path.join(this.options.dataDir, 'settings.json'), 'utf8')); vault = settings.vault.path; }
        catch (e: any) { if (e.code !== 'ENOENT') throw e; }
        vault = path.resolve(string(vault));
        if (this.store?.vault === vault && !this.error) return;
        this.imports.abort(); this.imports = new AbortController();
        await Promise.allSettled(this.operations);
        await this.updater?.stop();
        for (const guest of this.guests.values()) this.resetGuest(guest);
        const store = new UserscriptStore(vault, this.options.dataDir, this.changed);
        await store.load(); this.store = store; this.error = undefined;
        this.updater = new UserscriptUpdater(store, error => {
          this.statuses = [...this.statuses, { guestId: 0, url: '更新器', state: 'error', message: String(error), at: Date.now() }].slice(-128);
          this.changed();
        }); this.updater.start();
      } catch (e) { this.error = String(e); this.store = undefined; }
    })().finally(() => { this.switching = undefined; });
  }
  attach(contents: WebContents) {
    if (this.guests.has(contents.id)) return;
    const g: Guest = { contents, token: '', scripts: new Map(), menus: new Map(), requests: new Map() };
    this.guests.set(contents.id, g);
    const guard = (event: Electron.Event, url: string) => { if (!/^https?:\/\//i.test(url)) event.preventDefault(); };
    contents.on('will-navigate', guard);
    contents.on('will-redirect', guard);
    contents.on('will-frame-navigate', event => { if (!/^https?:\/\//i.test(event.url) && event.url !== 'about:blank') event.preventDefault(); });
    contents.on('did-start-navigation', (_event, _url, same, main) => { if (main && !same) this.resetGuest(g); });
    contents.on('did-navigate-in-page', (_event, _url, main) => { if (main && !contents.isDestroyed()) contents.send('userscripts:page'); });
    contents.setWindowOpenHandler(({ url }) => {
      const host = this.options.window();
      if (/^https?:\/\//i.test(url) && host && !host.isDestroyed()) {
        host.webContents.send('webviewer:open-tab', { sourceGuestId: contents.id, url });
      }
      return { action: 'deny' };
    });
    contents.once('render-process-gone', () => this.resetGuest(g));
    contents.on('console-message', (_event, level, message) => {
      if (level >= 3) this.addStatus(g, undefined, 'page-error', message.slice(0, 12000));
    });
    contents.once('destroyed', () => { this.resetGuest(g); this.guests.delete(contents.id); this.changed(); });
  }
  private resetGuest(g: Guest) {
    for (const request of g.requests.values()) request.abort();
    g.requests.clear(); g.menus.clear(); g.scripts.clear(); g.token = '';
    this.statuses = this.statuses.filter(s => s.guestId !== g.contents.id);
  }
  private guest(event: IpcEvent) {
    const g = this.guests.get(event.sender.id);
    if (!g || event.senderFrame !== event.sender.mainFrame || !/^https?:\/\//i.test(event.senderFrame?.url ?? '')) throw new Error('Unrecognized userscript guest');
    return g;
  }
  private initial = (event: IpcMainEvent) => {
    try {
      if (!this.guests.has(event.sender.id) && event.sender.getType() === 'webview' && event.sender.hostWebContents === this.options.window()?.webContents) this.attach(event.sender);
      const g = this.guest(event), store = this.requireStore();
      const scripts = store.snapshot().scripts.filter(s => s.enabled && !s.warnings.some(w => w.startsWith('Migration blocked:')) && !needsApproval(s.approved, s.metadata) && matches(event.senderFrame!.url, s.metadata));
      g.token ||= randomUUID();
      for (const s of scripts) if (!g.scripts.has(s.id)) g.scripts.set(s.id, s);
      event.returnValue = { token: g.token, scripts, values: Object.fromEntries(scripts.map(s => [s.id, store.values(s.id)])) };
    } catch (e) { event.returnValue = { scripts: [], values: {}, error: String(e) }; }
  };
  private requireStore() { if (!this.store || this.error || this.stopped) throw new Error(this.error || 'Userscripts are not ready'); return this.store; }
  private addStatus(g: Guest, scriptId: string | undefined, state: string, message?: string) {
    if (g.contents.isDestroyed()) return;
    const entry = { guestId: g.contents.id, url: g.contents.getURL(), scriptId, state, message, at: Date.now() };
    // One last state per script/document plus bounded recent errors.
    this.statuses = this.statuses.filter(s => !(s.guestId === entry.guestId && s.scriptId === scriptId));
    this.statuses.push(entry); this.statuses = this.statuses.slice(-128); this.changed();
  }
  private status = (event: IpcMainEvent, payload: any) => {
    try { const g = this.guest(event); this.addStatus(g, payload.scriptId ? string(payload.scriptId, 200) : undefined, string(payload.state, 40), payload.message ? string(payload.message, 12000) : undefined); }
    catch { /* Invalid sender cannot report native state. */ }
  };
  private manage = async (event: IpcMainInvokeEvent, action: unknown, payload: any = {}) => {
    if (!this.options.hostAllowed(event)) throw new Error('Local application frame required');
    await this.refreshVault();
    const operation = this.manageAction(string(action, 80), object(payload));
    this.operations.add(operation); try { return await operation; } finally { this.operations.delete(operation); }
  };
  private async manageAction(action: string, p: Record<string, any>): Promise<any> {
    const store = this.requireStore();
    switch (action) {
      case 'list': return { ...store.snapshot(), statuses: this.statuses };
      case 'menus': return [...this.guests.values()].flatMap(g => [...g.menus.values()].filter(m => {
        try { const s = store.get(m.scriptId); return s.enabled && matches(g.contents.getURL(), s.metadata); } catch { return false; }
      }));
      case 'invoke-menu': {
        const g = this.guests.get(Number(p.guestId)), id = string(p.id, 200), scriptId = string(p.scriptId, 200);
        if (!g || !g.menus.has(scriptId + ':' + id)) throw new Error('Menu command is no longer available');
        const script = store.get(scriptId);
        if (!script.enabled || !matches(g.contents.getURL(), script.metadata)) throw new Error('Script is disabled or no longer matches this page');
        g.contents.send('userscripts:menu', { token: g.token, scriptId, id }); return;
      }
      case 'import': case 'save': {
        let source: string, sourceUrl: string | undefined;
        if (p.url !== undefined) {
          sourceUrl = string(p.url);
          if (!new URL(sourceUrl).pathname.endsWith('.user.js')) throw new Error('Import URL must end in .user.js');
          const r = await scriptFetch(sourceUrl, { signal: this.imports.signal });
          if (r.status !== 200) throw new Error('Import HTTP ' + r.status);
          source = r.bytes.toString('utf8');
        } else source = string(p.source, 8 * 1024 * 1024);
        const bundle = await prepareBundle(source, this.imports.signal);
        // Import/edit preserves existing state; only explicit approval changes authority.
        return store.install(bundle, { id: p.id === undefined ? undefined : string(p.id, 200), revision: p.revision, sourceUrl });
      }
      case 'configure': {
        const id = string(p.id, 200);
        await store.mutate(d => {
          const s = d.scripts.find(s => s.id === id); if (!s) throw new Error('Script no longer exists');
          if (p.enabled !== undefined) {
            if (p.enabled && (needsApproval(s.approved, s.metadata) || s.warnings.some(w => w.startsWith('Migration blocked:')))) throw new Error('Review/approve this script before enabling it');
            s.enabled = bool(p.enabled);
          }
          if (p.autoUpdate !== undefined) s.autoUpdate = bool(p.autoUpdate);
        });
        if (p.enabled === false) for (const g of this.guests.values()) {
          for (const [key, request] of g.requests) if (key.startsWith(id + ':')) request.abort();
        }
        return;
      }
      case 'approve': {
        const id = string(p.id, 200), revision = p.revision;
        await store.mutate(d => {
          const s = d.scripts.find(s => s.id === id);
          if (!s || s.revision !== revision) throw new Error('Source changed since review; review again');
          if (p.pending) {
            const pending = s.update.pending; if (!pending) throw new Error('No pending update');
            if (!s.update.candidateId || p.candidateId !== s.update.candidateId) throw new Error('Pending source changed since review; review again');
            Object.assign(s, pending, { revision: s.revision + 1, updatedAt: Date.now(), sourceUrl: s.update.pendingSourceUrl ?? s.sourceUrl, update: { state: 'updated', checkedAt: Date.now() } });
          }
          if (s.warnings.some(w => w.startsWith('Migration blocked:'))) throw new Error('Repair/reimport unsupported source first');
          s.approved = approval(s);
        }); return;
      }
      case 'remove': {
        const id = string(p.id, 200);
        await store.mutate(d => {
          const old = d.scripts.find(s => s.id === id); if (!old) throw new Error('Script no longer exists');
          if (p.keepValues) (d.retained ??= {})[identity(old.metadata)] = id; else delete d.values[id];
          d.scripts = d.scripts.filter(s => s.id !== id);
        });
        for (const g of this.guests.values()) { for (const [key, menu] of g.menus) if (menu.scriptId === id) g.menus.delete(key); }
        for (const g of this.guests.values()) for (const [key, request] of g.requests) if (key.startsWith(id + ':')) request.abort();
        return;
      }
      case 'check': case 'update': {
        const ids = p.id ? [string(p.id, 200)] : store.snapshot().scripts.map(s => s.id);
        for (const id of ids) await this.updater!.check(id, action === 'update'); return;
      }
      case 'values': return store.values(string(p.id, 200));
      case 'set-values': {
        const id = string(p.id, 200), patch = object(p.values), old = store.values(id), deleted = Object.keys(old).filter(k => !Object.hasOwn(patch, k));
        await store.setValues(id, patch, deleted); this.broadcastValues(id, patch, deleted); return;
      }
      case 'settings': await store.mutate(d => {
        if (p.autoUpdate !== undefined) d.autoUpdate = bool(p.autoUpdate);
        if (p.intervalHours !== undefined) { if (!Number.isFinite(p.intervalHours) || p.intervalHours < 1 || p.intervalHours > 720) throw new Error('Interval must be 1–720 hours'); d.intervalHours = p.intervalHours; }
      }); return;
      default: throw new Error('Unknown userscript management action');
    }
  }
  private broadcastValues(id: string, patch: Record<string, unknown>, deleted: string[], except?: number) {
    for (const g of this.guests.values()) if (g.contents.id !== except && !g.contents.isDestroyed() && g.scripts.has(id)) g.contents.send('userscripts:values', { scriptId: id, patch, deleted });
  }
  private guestOperation = async (event: IpcMainInvokeEvent, raw: unknown) => {
    const p = object(raw), g = this.guest(event), id = string(p.scriptId, 200), store = this.requireStore();
    const script = g.scripts.get(id), current = store.get(id);
    if (!script || p.token !== g.token || p.revision !== script.revision || !current.enabled ||
      !matches(event.senderFrame!.url, script.metadata) || !matches(event.senderFrame!.url, current.metadata)) throw new Error('Script capability expired; reload the page');
    const action = string(p.action, 50), data = object(p.payload ?? {});
    const aliases: Record<string, string[]> = {
      values: ['GM_setValue', 'GM_deleteValue', 'GM_setValues', 'GM_deleteValues', 'GM.setValue', 'GM.deleteValue', 'GM.setValues', 'GM.deleteValues'],
      http: ['GM_xmlhttpRequest', 'GM.xmlHttpRequest'], abort: ['GM_xmlhttpRequest', 'GM.xmlHttpRequest'],
      menu: ['GM_registerMenuCommand', 'GM.registerMenuCommand'], unmenu: ['GM_unregisterMenuCommand', 'GM.unregisterMenuCommand', 'GM_registerMenuCommand', 'GM.registerMenuCommand'],
      clipboard: ['GM_setClipboard', 'GM.setClipboard'], notification: ['GM_notification', 'GM.notification'],
    };
    const granted = (names: string[]) => names.some(a => script.metadata.grants.includes(a) && current.metadata.grants.includes(a) && current.approved.grants.includes(a));
    if (!aliases[action] || !granted(aliases[action])) throw new Error('Operation is not declared in @grant: ' + action);
    try {
      if (action === 'values') {
        const patch = object(data.patch), deleted = data.deleted;
        if (!Array.isArray(deleted) || deleted.some(k => typeof k !== 'string')) throw new Error('Invalid deleted keys');
        if (Object.keys(patch).length && !granted(['GM_setValue', 'GM_setValues', 'GM.setValue', 'GM.setValues'])) throw new Error('Storage write is not granted');
        if (deleted.length && !granted(['GM_deleteValue', 'GM_deleteValues', 'GM.deleteValue', 'GM.deleteValues'])) throw new Error('Storage deletion is not granted');
        await store.setValues(id, patch, deleted); this.broadcastValues(id, patch, deleted, g.contents.id); return;
      }
      if (action === 'menu') { const key = string(data.id, 200); if (g.menus.size >= 256) throw new Error('Too many menu commands'); g.menus.set(id + ':' + key, { guestId: g.contents.id, scriptId: id, id: key, label: string(data.label, 300), url: event.senderFrame!.url }); this.changed(); return; }
      if (action === 'unmenu') { g.menus.delete(id + ':' + string(data.id, 200)); this.changed(); return; }
      if (action === 'clipboard') { clipboard.writeText(string(data.text, 8 * 1024 * 1024)); return; }
      if (action === 'notification') {
        if (!Notification.isSupported()) throw new Error('Native notifications are unavailable');
        new Notification({ title: string(data.title ?? script.metadata.name, 300), body: string(data.text ?? '', 4000), silent: !!data.silent }).show(); return;
      }
      const requestId = id + ':' + string(data.id, 200);
      if (action === 'abort') { g.requests.get(requestId)?.abort(); return; }
      if (g.requests.size >= 16) throw new Error('Too many concurrent GM requests (maximum 16 per guest)');
      const controller = new AbortController(); g.requests.set(requestId, controller);
      try {
        const page = event.senderFrame!.url;
        const allow = (url: string) => {
          const latest = store.get(id);
          return latest.enabled && p.token === g.token && matches(page, latest.metadata) &&
            connectAllowed(url, page, script.metadata.connects) && connectAllowed(url, page, latest.metadata.connects) && connectAllowed(url, page, latest.approved.connects);
        };
        const headers = Object.fromEntries(Object.entries(object(data.headers)).map(([k, v]) => [k, string(v, 16000)]));
        const r = await scriptFetch(string(data.url), { method: string(data.method, 20), headers,
          body: data.body === undefined || data.body === null ? undefined : string(data.body, 8 * 1024 * 1024), timeout: data.timeout,
          allow, signal: controller.signal, session: g.contents.session, anonymous: data.anonymous === true, maxBytes: 16 * 1024 * 1024 });
        if (p.token !== g.token || !allow(r.url)) throw new Error('Page navigated or script permissions changed during request');
        return { status: r.status, statusText: r.statusText, url: r.url, base64: r.bytes.toString('base64'),
          contentType: r.headers['content-type'], responseHeaders: Object.entries(r.headers).map(([k, v]) => k + ': ' + v).join('\r\n') };
      } finally { g.requests.delete(requestId); }
    } catch (e) { this.addStatus(g, id, 'error', String(e)); throw e; }
  };
  async stop() {
    this.stopped = true; this.imports.abort();
    ipcMain.removeHandler('userscripts:manage'); ipcMain.removeListener('userscripts:initial', this.initial);
    ipcMain.removeHandler('userscripts:guest-op'); ipcMain.removeListener('userscripts:status', this.status);
    app.removeListener('web-contents-created', this.created);
    for (const g of this.guests.values()) this.resetGuest(g);
    await this.updater?.stop(); await Promise.allSettled(this.operations); await this.store?.flush();
  }
}
