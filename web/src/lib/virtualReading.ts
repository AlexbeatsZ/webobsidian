import { useSyncExternalStore } from 'react';
import type { VirtualDocument } from './virtualDocuments';
import type { PdfOutlineEntry } from './pdf/types';
import type { ViewMode } from './store';

export interface ReadingTarget { path: string; fragment?: string; page?: number }
export interface VirtualReadingSnapshot {
  stream: string; serial: number; target?: ReadingTarget;
  configuration: boolean; mode: ViewMode; activeSource?: string;
  pdfOutlines: Readonly<Record<string, readonly PdfOutlineEntry[]>>;
}
const readers = new Map<string, VirtualReadingSession>(), listeners = new Set<() => void>();
const queuedTargets = new Map<string, ReadingTarget>();
export function queueVirtualReading(path: string, viewId: string, target: ReadingTarget) {
  const id = key(path, viewId), current = readers.get(id);
  if (current) current.go(target);
  else { queuedTargets.set(id, target); if (queuedTargets.size > 20) queuedTargets.delete(queuedTargets.keys().next().value!); }
}
const progresses = new Map<string, { stream: string; top: number; heights: number[] }>();
const selectedStreams = new Map<string, string>();
const key = (path: string, view: string) => view + '\0' + path;
const notify = () => { for (const listener of listeners) listener(); };
export class VirtualReadingSession {
  private listeners = new Set<() => void>();
  private state: VirtualReadingSnapshot;
  readonly progressKey: string;
  constructor(public document: VirtualDocument, readonly viewId: string, mode: ViewMode = 'live') {
    this.progressKey = key(document.path, viewId);
    const selected = selectedStreams.get(this.progressKey);
    this.state = { stream: document.streams.find(stream => stream.id === selected)?.id ?? document.streams[0].id,
      serial: 0, pdfOutlines: {}, configuration: false, mode };
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  private update(patch: Partial<VirtualReadingSnapshot>) {
    this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener();
  }
  selectStream(id: string) {
    if (!this.document.streams.some(stream => stream.id === id)) return;
    selectedStreams.set(this.progressKey, id);
    if (id !== this.state.stream || this.state.configuration) this.update({ stream: id, configuration: false, activeSource: undefined, target: undefined, serial: this.state.serial + 1 });
  }
  selectConfiguration() { this.update({ configuration: true, target: undefined }); }
  setMode = (mode: ViewMode) => { if (mode !== this.state.mode) this.update({ mode }); };
  activateSource(path: string) { if (path !== this.state.activeSource) this.update({ activeSource: path }); }
  replaceDocument(document: VirtualDocument) {
    if (JSON.stringify(document) === JSON.stringify(this.document)) return;
    for (const stream of document.streams) {
      const before = this.document.streams.find(item => item.id === stream.id);
      if (JSON.stringify(before?.files.map(file => file.path)) !== JSON.stringify(stream.files.map(file => file.path)))
        progresses.delete(this.progressKey + '\0' + stream.id);
    }
    this.document = document;
    const stream = document.streams.some(stream => stream.id === this.state.stream) ? this.state.stream : document.streams[0].id;
    this.update({ stream });
  }
  go = (target: ReadingTarget) => {
    const stream = this.document.streams.find(stream => stream.id === this.state.stream && stream.files.some(file => file.path === target.path))
      ?? this.document.streams.find(stream => stream.files.some(file => file.path === target.path));
    if (stream) this.update({ stream: stream.id, configuration: false, activeSource: target.path, target, serial: this.state.serial + 1 });
  };
  releaseTarget() { if (this.state.target) this.update({ target: undefined }); }
  outline(path: string, entries: readonly PdfOutlineEntry[]) {
    if (this.state.pdfOutlines[path] !== entries) this.update({ pdfOutlines: { ...this.state.pdfOutlines, [path]: entries } });
  }
  remember(stream: string, top: number, heights: number[]) {
    const key = this.progressKey + '\0' + stream;
    selectedStreams.set(this.progressKey, this.state.stream);
    progresses.delete(key);
    progresses.set(key, { stream, top, heights });
    if (progresses.size > 20) progresses.delete(progresses.keys().next().value!);
  }
  progress() { return progresses.get(this.progressKey + '\0' + this.state.stream); }
}
export function registerVirtualReading(session: VirtualReadingSession) {
  const id = key(session.document.path, session.viewId);
  readers.set(id, session); notify();
  const target = queuedTargets.get(id);
  if (target) { queuedTargets.delete(id); session.go(target); }
  return () => { if (readers.get(id) === session) { readers.delete(id); notify(); } };
}
export function useVirtualReading(path: string | null, viewId: string) {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => path ? readers.get(key(path, viewId)) : undefined);
}
