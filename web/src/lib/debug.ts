import { api } from './api';

export interface DebugEvent { session: string; sequence: number; time: string; elapsed: number; type: string; data: unknown }
type DebugView = (reason: string) => void;
const views = new Set<DebugView>(), listeners = new Set<() => void>();
const encoder = new TextEncoder();
const session = crypto.randomUUID(), started = performance.now();
let sequence = 0, timer: ReturnType<typeof setInterval> | undefined, pending: Promise<void> | undefined;
let stopEvents: (() => void) | undefined, bytes = 0;
const buffer: { event: DebugEvent; bytes: number }[] = [];
let status = { enabled: false, source: true, recorded: 0, queued: 0, dropped: 0, error: '' };
const publish = () => { status = { ...status, queued: buffer.length }; listeners.forEach(listener => listener()); };
export const debugStatus = () => status;
export const subscribeDebug = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const debugEnabled = () => status.enabled;
export const debugSource = () => status.source;
export const debugText = (text: string) => status.source ? { text: text.slice(0, 65536), length: text.length, truncated: text.length > 65536 } : { length: text.length };
export const debugError = (error: unknown) => error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { message: String(error) };

export function recordDebug(type: string, data: unknown) {
  if (!status.enabled) return;
  try {
    const event = { session, sequence: sequence++, time: new Date().toISOString(), elapsed: performance.now() - started, type, data };
    const size = encoder.encode(JSON.stringify(event)).byteLength;
    // Keep complete events. Explicit gaps/truncation make bounded exports honest.
    if (size > 1024 * 1024) { status.dropped++; return; }
    while (buffer.length && (bytes + size > 4 * 1024 * 1024 || buffer.length >= 4096)) {
      bytes -= buffer.shift()!.bytes; status.dropped++;
    }
    buffer.push({ event, bytes: size }); bytes += size; status.recorded++;
  } catch { status.dropped++; }
}

export function registerDebugView(capture: DebugView) {
  views.add(capture);
  return () => { views.delete(capture); };
}
export function captureDebug(reason = 'manual') {
  if (!status.enabled) return;
  recordDebug('capture', { reason, views: views.size, dropped: status.dropped });
  for (const capture of views) { try { capture(reason); } catch (error) { recordDebug('capture.error', debugError(error)); } }
}

export async function flushDebug(): Promise<void> {
  if (pending) { await pending; return; }
  if (!buffer.length) return;
  let size = 0;
  const batch: typeof buffer = [];
  for (const row of buffer) { if (batch.length >= 256 || size + row.bytes > 1536 * 1024) break; batch.push(row); size += row.bytes; }
  pending = (async () => {
    try {
      if ((await api.appendDebug(batch.map(row => row.event)))?.ok !== true) throw new Error('调试日志保存未获确认');
      // Records may have rotated out of the bounded memory buffer during I/O.
      const sent = new Set(batch); for (let i = buffer.length - 1; i >= 0; i--) if (sent.has(buffer[i])) { bytes -= buffer[i].bytes; buffer.splice(i, 1); }
      status.error = '';
    } catch (error) { status.error = String(error); }
    finally { pending = undefined; publish(); }
  })();
  await pending;
}
async function drainDebug() {
  for (let i = 0; buffer.length && i < 32; i++) {
    await flushDebug(); if (status.error) break;
  }
}

/** Applies the existing UI preference; no view-local recording lifetime. */
export function configureDebug(enabled: boolean, source = true) {
  if (enabled === status.enabled && source === status.source) return;
  const wasEnabled = status.enabled;
  if (wasEnabled && !enabled) recordDebug('recording.stop', { dropped: status.dropped });
  status = { ...status, enabled, source };
  if (!enabled) {
    if (timer) clearInterval(timer); timer = undefined; stopEvents?.(); stopEvents = undefined;
    // Caller flushes before persisting the disabled preference.
    publish(); return;
  }
  if (!wasEnabled) {
    const onError = (event: ErrorEvent) => { recordDebug('window.error', { ...debugError(event.error ?? event.message), file: event.filename, line: event.lineno, column: event.colno }); captureDebug('window.error'); };
    const onRejection = (event: PromiseRejectionEvent) => { recordDebug('window.rejection', debugError(event.reason)); captureDebug('window.rejection'); };
    const visibility = () => recordDebug('visibility', { state: document.visibilityState });
    const pagehide = () => {
      recordDebug('pagehide', {});
      const batch = buffer.slice(-128).map(row => row.event);
      const body = JSON.stringify(batch);
      // sendBeacon's browser quota is small. The regular 2s flush owns larger batches.
      if (batch.length && encoder.encode(body).byteLength < 60000) navigator.sendBeacon('/api/settings/debug', new Blob([body], { type: 'application/json' }));
    };
    window.addEventListener('error', onError); window.addEventListener('unhandledrejection', onRejection);
    document.addEventListener('visibilitychange', visibility); window.addEventListener('pagehide', pagehide);
    const originalError = console.error, originalWarn = console.warn;
    const logError = (...args: unknown[]) => { recordDebug('console.error', args.map(debugError)); originalError.apply(console, args); };
    const logWarn = (...args: unknown[]) => { recordDebug('console.warn', args.map(debugError)); originalWarn.apply(console, args); };
    console.error = logError; console.warn = logWarn;
    let observer: PerformanceObserver | undefined;
    if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes.includes('longtask')) {
      observer = new PerformanceObserver(list => { for (const entry of list.getEntries()) recordDebug('longtask', { start: entry.startTime, duration: entry.duration, name: entry.name }); });
      observer.observe({ type: 'longtask' });
    }
    stopEvents = () => {
      window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onRejection);
      document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', pagehide); observer?.disconnect();
      if (console.error === logError) console.error = originalError;
      if (console.warn === logWarn) console.warn = originalWarn;
    };
    timer = setInterval(() => { void flushDebug(); publish(); }, 2000);
    recordDebug('recording.start', { userAgent: navigator.userAgent, origin: location.origin, pixelRatio: devicePixelRatio,
      viewport: [innerWidth, innerHeight], source, version: __APP_VERSION__, mathjax: __MATHJAX_VERSION__ });
  } else recordDebug('recording.options', { source });
  captureDebug(wasEnabled ? 'options' : 'enabled'); publish();
}

export async function updateDebug(enabled: boolean, source: boolean) {
  const previous = { enabled: status.enabled, source: status.source };
  if (!enabled && status.enabled) {
    configureDebug(false, source); await drainDebug();
    // Retain failed batches rather than silently claiming that they were saved.
    if (buffer.length) { configureDebug(true, source); throw new Error(status.error || '调试日志尚未保存'); }
  }
  try {
    const settings = await api.putSettings({ ui: { debugRecording: enabled, debugSource: source } });
    configureDebug(settings.ui.debugRecording, settings.ui.debugSource);
  } catch (error) { configureDebug(previous.enabled, previous.source); throw error; }
}

export async function exportDebug() {
  captureDebug('export'); await drainDebug();
  let text = '';
  try {
    const result = await api.readDebug();
    if (typeof result?.text !== 'string') throw new Error('调试日志读取结果无效');
    text = result.text;
  }
  catch (error) { status.error = String(error); publish(); }
  const header = JSON.stringify({ type: 'export', time: new Date().toISOString(), session, dropped: status.dropped, unsaved: buffer.length, error: status.error }) + '\n';
  const tail = buffer.map(row => JSON.stringify(row.event) + '\n').join('');
  const url = URL.createObjectURL(new Blob([header, text, tail], { type: 'application/x-ndjson;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `webobsidian-debug-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
