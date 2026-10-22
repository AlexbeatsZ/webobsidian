import type { ScriptRecord } from '../../../web/src/lib/userscripts/types';

/** This function is serialized into the guest world; keep it self-contained. */
function setupRuntime(script: ScriptRecord, initial: Record<string, unknown>, bridgeName: string, slot: string) {
  const root = globalThis as any, bridge = root[bridgeName];
  const values: Record<string, unknown> = Object.assign(Object.create(null), initial);
  const clone = (v: any) => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  const listeners = new Map<number, { key: string; fn: Function }>();
  const menus = new Map<string, Function>();
  let sequence = 0;
  const report = (error: unknown) => bridge.report(String(error));
  const call = (action: string, payload?: any) => bridge.request(action, payload);
  const changed = (key: string, next: unknown, remote: boolean, deleted = false) => {
    const old = clone(values[key]);
    if (deleted) delete values[key]; else values[key] = clone(next);
    for (const listener of listeners.values()) if (listener.key === key) {
      try { Promise.resolve(listener.fn(key, old, clone(values[key]), remote)).catch(report); } catch (e) { report(e); }
    }
  };
  const mutate = (patch: Record<string, unknown>, deleted: string[] = []) => {
    // Validate JSON before any local mutation. Undefined values are explicitly rejected.
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) throw new Error('GM values must be JSON; use deleteValue for undefined');
      clone(value); changed(key, value, false);
    }
    for (const key of deleted) changed(key, undefined, false, true);
    return call('values', { patch, deleted });
  };
  const apis: Record<string, any> = {
    GM_getValue: (key: string, fallback?: unknown) => Object.hasOwn(values, String(key)) ? clone(values[String(key)]) : fallback,
    GM_listValues: () => Object.keys(values),
    GM_getValues: (keys?: string[] | Record<string, unknown>) => {
      if (keys === undefined) return clone(values);
      const result: Record<string, unknown> = {};
      for (const key of Array.isArray(keys) ? keys : Object.keys(keys)) result[key] = Object.hasOwn(values, key) ? clone(values[key]) : Array.isArray(keys) ? undefined : keys[key];
      return result;
    },
    GM_setValue: (key: string, value: unknown) => { void mutate({ [String(key)]: value }).catch(report); },
    GM_deleteValue: (key: string) => { void mutate({}, [String(key)]).catch(report); },
    GM_setValues: (patch: Record<string, unknown>) => { void mutate(patch).catch(report); },
    GM_deleteValues: (keys: string[]) => { void mutate({}, keys).catch(report); },
    GM_addValueChangeListener: (key: string, fn: Function) => { const id = ++sequence; listeners.set(id, { key: String(key), fn }); return id; },
    GM_removeValueChangeListener: (id: number) => listeners.delete(id),
    GM_addStyle: (css: string) => {
      const style = document.createElement('style'); style.textContent = String(css);
      if (document.head || document.documentElement) (document.head || document.documentElement).append(style);
      else new MutationObserver((_, observer) => { if (document.documentElement) { document.documentElement.append(style); observer.disconnect(); } }).observe(document, { childList: true });
      return style;
    },
    GM_addElement: (...args: any[]) => {
      const parent = typeof args[0] === 'string' ? document.head || document.documentElement : args.shift();
      const [tag, attrs = {}] = args;
      const el = document.createElement(String(tag));
      for (const [name, value] of Object.entries(attrs)) { if (name === 'textContent') el.textContent = String(value); else el.setAttribute(name, String(value)); }
      if (!parent) throw new Error('No parent for GM_addElement at document-start; supply an explicit parent');
      parent.append(el); return el;
    },
    GM_getResourceText: (name: string) => { const r = script.resources[name]; if (!r) throw new Error('Unknown @resource: ' + name); return r.source; },
    GM_getResourceURL: (name: string) => { const r = script.resources[name]; if (!r?.dataUrl) throw new Error('Unknown @resource: ' + name); return r.dataUrl; },
    GM_registerMenuCommand: (label: string, fn: Function, options?: any) => {
      if (options && (typeof options !== 'object' || Object.keys(options).some(k => k !== 'id'))) throw new Error('Menu options supported: id only; access keys/other options are unavailable');
      const id = String(options?.id ?? ++sequence); menus.set(id, fn);
      void call('menu', { id, label: String(label) }).catch(report); return id;
    },
    GM_unregisterMenuCommand: (id: string) => { menus.delete(String(id)); void call('unmenu', { id: String(id) }).catch(report); },
    GM_setClipboard: (data: string, info?: any, cb?: Function) => {
      if (info && info !== 'text' && info !== 'text/plain' && !(info.type === 'text' && (!info.mimetype || info.mimetype === 'text/plain'))) throw new Error('Clipboard supports plain text only');
      const p = call('clipboard', { text: String(data) }); if (cb) void p.then(() => cb()).catch(report); return p;
    },
    GM_notification: (details: any, title?: string) => {
      const o = typeof details === 'string' ? { text: details, title } : details;
      if (Object.keys(o ?? {}).some(k => !['text', 'title', 'silent'].includes(k))) throw new Error('Notifications support text/title/silent only');
      return call('notification', o);
    },
    GM_log: (...args: any[]) => console.log('[Userscript ' + script.metadata.name + ']', ...args),
    GM_info: { script: script.metadata, scriptMetaStr: script.source.match(/\/\/\s*==UserScript==[\s\S]*?\/\/\s*==\/UserScript==/)?.[0] ?? '',
      scriptHandler: 'WebObsidian', version: '1', scriptWillUpdate: script.autoUpdate, injectInto: bridge.world },
    unsafeWindow: window,
  };
  const xhr = (details: any, promiseMode: boolean) => {
    const supported = ['url', 'method', 'headers', 'data', 'responseType', 'timeout', 'anonymous', 'context', 'onload', 'onerror', 'onabort', 'ontimeout', 'onloadend', 'onreadystatechange'];
    for (const key of Object.keys(details ?? {})) if (!supported.includes(key)) throw new Error('Unsupported GM request option: ' + key);
    if (!details?.url) throw new Error('GM request needs url');
    const responseType = details.responseType || 'text';
    if (!['text', 'json', 'arraybuffer', 'blob', 'document'].includes(responseType)) throw new Error('Unsupported GM responseType: ' + responseType);
    let data = details.data;
    if (data instanceof URLSearchParams) data = data.toString();
    if (data != null && typeof data !== 'string') throw new Error('GM request data supports strings/URLSearchParams only');
    const id = String(++sequence);
    let aborted = false;
    const invoke = (name: string, response: any) => { try { details[name]?.(response); } catch (e) { report(e); } };
    const response = call('http', { id, url: new URL(String(details.url), location.href).href,
      method: String(details.method || 'GET').toUpperCase(), headers: details.headers || {}, body: data,
      timeout: details.timeout, anonymous: details.anonymous === true }).then((r: any) => {
      const bytes = Uint8Array.from(atob(r.base64), (c: string) => c.charCodeAt(0));
      const text = new TextDecoder().decode(bytes);
      let value: any = text;
      if (responseType === 'json') { try { value = JSON.parse(text); } catch { value = null; } }
      if (responseType === 'arraybuffer') value = bytes.buffer;
      if (responseType === 'blob') value = new Blob([bytes], { type: r.contentType || '' });
      if (responseType === 'document') value = new DOMParser().parseFromString(text, 'text/html');
      const result = { status: r.status, statusText: r.statusText, finalUrl: r.url, responseHeaders: r.responseHeaders,
        readyState: 4, responseText: text, response: value, responseXML: responseType === 'document' ? value : null, context: details.context };
      if (!aborted) { invoke('onreadystatechange', result); invoke('onload', result); invoke('onloadend', result); }
      return result;
    }).catch((e: any) => {
      const error = { status: 0, readyState: 4, statusText: String(e), responseText: '', response: null, context: details.context };
      invoke(aborted ? 'onabort' : /timeout/i.test(String(e)) ? 'ontimeout' : 'onerror', error); invoke('onloadend', error);
      throw error;
    });
    const abort = () => { if (!aborted) { aborted = true; void call('abort', { id }).catch(report); } };
    if (promiseMode) return Object.assign(response, { abort });
    void response.catch(() => {}); return { abort };
  };
  apis.GM_xmlhttpRequest = (d: any) => xhr(d, false);
  const GM: Record<string, any> = { info: apis.GM_info };
  for (const [name, api] of Object.entries(apis)) if (name.startsWith('GM_')) {
    const key = name.slice(3); GM[key === 'xmlhttpRequest' ? 'xmlHttpRequest' : key] = typeof api === 'function' ? (...args: any[]) => Promise.resolve(api(...args)) : api;
  }
  GM.setValue = (key: string, value: unknown) => mutate({ [String(key)]: value });
  GM.setValues = (patch: Record<string, unknown>) => mutate(patch);
  GM.deleteValue = (key: string) => mutate({}, [String(key)]);
  GM.deleteValues = (keys: string[]) => mutate({}, keys);
  GM.xmlHttpRequest = (d: any) => xhr(d, true);
  GM.getResourceUrl = GM.getResourceURL;
  // Only declared grants become lexical bindings. GM_info/GM.info is always available.
  const grants = script.metadata.grants;
  const allowed: Record<string, any> = { GM_info: apis.GM_info };
  const gmAllowed: Record<string, any> = { info: GM.info };
  for (const grant of grants) {
    if (grant.startsWith('GM.')) gmAllowed[grant.slice(3)] = GM[grant.slice(3)];
    else if (grant in apis) allowed[grant] = apis[grant];
  }
  // Legacy grants also expose their modern equivalents, matching practical scripts.
  for (const grant of grants.filter(g => g.startsWith('GM_'))) {
    const key = grant.slice(3) === 'xmlhttpRequest' ? 'xmlHttpRequest' : grant.slice(3);
    if (key in GM) gmAllowed[key] = GM[key];
  }
  allowed.GM = gmAllowed;
  root[slot] = {
    apis: allowed,
    invoke: (id: string) => { const fn = menus.get(id); if (!fn) throw new Error('Menu command is no longer registered'); return Promise.resolve(fn()).catch(report); },
    remote: (patch: Record<string, unknown>, deleted: string[]) => {
      for (const key of deleted) changed(key, undefined, true, true);
      for (const [key, value] of Object.entries(patch)) changed(key, value, true);
    },
  };
  return true;
}
export function injectionSource(script: ScriptRecord, values: Record<string, unknown>, bridgeName: string, slot: string) {
  const names = ['GM', 'GM_info', ...script.metadata.grants.filter(g => /^[A-Za-z_$][\w$]*$/.test(g) && g !== 'none')];
  const unique = [...new Set(names)];
  return `(() => { try {
    (${setupRuntime.toString()})(${JSON.stringify(script)},${JSON.stringify(values)},${JSON.stringify(bridgeName)},${JSON.stringify(slot)});
    const api = globalThis[${JSON.stringify(slot)}].apis;
    (function(${unique.join(',')}) {
      ${script.requires.map(r => r.source + '\n;').join('\n')}
      ;(function(){\n${script.source}\n}).call(window);
    }).call(window,${unique.map(n => 'api[' + JSON.stringify(n) + ']').join(',')});
    return {ok:true};
  } catch(error) { return {ok:false,error:String(error && error.stack || error)}; } })()`;
}
