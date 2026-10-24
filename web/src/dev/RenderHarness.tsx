import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { DocumentSession, analyzeMarkdown, fragmentRange, parseLinkTarget, type SourceChange } from '@webobsidian/markdown-core';
import type { EditorView } from '@codemirror/view';
import CanvasView from '../components/CanvasView';
import { useStore } from '../lib/store';
import { preparePrintDocument } from '../lib/printDocument';
import MarkdownView, { type MarkdownMode } from '../components/MarkdownView';
import { registerEditor, getActiveEditor, fmtInline } from '../lib/activeEditor';
import type { RenderContext } from '../lib/renderContext';
import DebugSettings from '../components/DebugSettings';
import { api } from '../lib/api';
import { configureDebug } from '../lib/debug';
import { StateEffect } from '@codemirror/state';
import { ViewPlugin } from '@codemirror/view';

export interface RenderHarnessApi {
  reset: (source: string, shared?: boolean) => void;
  cursor: (slot: number, from: number, to?: number) => void;
  edit: (slot: number, changes: SourceChange[]) => void;
  source: (slot: number) => string;
  save: (slot: number) => Promise<void>;
  mode: (slot: number, mode: MarkdownMode) => void;
  undo: (slot: number) => void;
  focus: (slot: number) => void;
  closeSecondary: () => void;
  activeDocument: () => string | null;
  format: (mark: string) => void;
  coords: (slot: number, position: number) => { left: number; top: number } | null;
  scroll: (slot: number, top: number) => void;
  canvas: (source: string) => void;
  canvasRaw: () => string;
  preparePrint: () => Promise<void>;
  notes: (notes: Record<string, string>) => void;
  changeNote: (path: string, source: string) => void;
  crashPlugin: (slot: number) => void;
  links: string[];
  writes: string[];
}
declare global { interface Window { renderHarness: RenderHarnessApi } }

function HarnessView({ session, mode, context, ready }: {
  session: DocumentSession; mode: MarkdownMode; context: RenderContext; ready: (v: EditorView | null) => void;
}) {
  const snapshot = useSyncExternalStore(session.subscribe, () => session.snapshot);
  return <MarkdownView snapshot={snapshot} mode={mode} context={context} showTitle={false}
    onChange={(changes, version, origin) => { session.edit(version, changes, origin); return session.snapshot; }}
    onUndo={() => { session.undo(); return session.snapshot; }}
    onRedo={() => { session.redo(); return session.snapshot; }}
    onReady={ready} />;
}

/** Dev-only entry. No production vault, authentication, settings or save API. */
export default function RenderHarness() {
  const debugging = new URLSearchParams(location.search).has('debug');
  useEffect(() => {
    if (debugging) void api.getSettings().then(settings => configureDebug(Boolean(settings.ui?.debugRecording), settings.ui?.debugSource !== false));
    return () => { if (debugging) configureDebug(false); };
  }, [debugging]);
  const [config, setConfig] = useState({ source: '# Title\n\n**bold** and plain.\n\nCaret sentinel.', shared: true, generation: 0 });
  const [modes, setModes] = useState<MarkdownMode[]>(['live', 'reading']);
  const [canvas, setCanvas] = useState(false);
  const [secondary, setSecondary] = useState(true);
  const refs = useRef<(EditorView | null)[]>([]);
  const removers = useRef<(() => void)[]>([]);
  const links = useRef<string[]>([]);
  const writes = useRef<string[]>([]);
  const notes = useRef(new Map<string, DocumentSession>());
  const sessions = useMemo(() => {
    const writer = async (_id: string, raw: string) => { writes.current.push(raw); return { revision: String(writes.current.length) }; };
    const a = new DocumentSession('a.md', config.source, 'r0', writer);
    return [a, config.shared ? a : new DocumentSession('b.md', config.source, 'r0', writer)];
  }, [config]);
  const contexts = useMemo(() => sessions.map((session, slot): RenderContext => {
    const contextFor = (path: string): RenderContext => ({
    bindEditor: registerEditor, sourcePath: path, openLink: (target) => { links.current.push(slot + ':' + target); }, openMenu: () => {},
    rawUrl: (target) => target, files: () => [], tags: async () => [], properties: async () => [],
    propertyTypes: () => ({}), setPropertyType: async () => ({}), renderEmbed: async target => {
      const parsed = parseLinkTarget(target);
      const id = parsed.path ? (parsed.path.endsWith('.md') ? parsed.path : parsed.path + '.md') : path;
      const note = notes.current.get(id); if (!note) return null;
      return { path: id, context: contextFor(id), subscribe: note.subscribe, read: () => {
        const range = fragmentRange(analyzeMarkdown(note.snapshot.text), parsed.fragment);
        return range ? { source: note.snapshot.text.slice(range.from, range.to), from: range.from } : null;
      } };
    },
    }); return contextFor(session.id);
  }), [sessions]);
  useEffect(() => {
    window.renderHarness = {
      canvas: source => {
        useStore.setState({ activePath: 'fixture.canvas', content: source, dirty: false,
          setContent: content => useStore.setState({ content, dirty: true }),
          save: async () => { writes.current.push(useStore.getState().content); },
        }); setCanvas(true);
      },
      canvasRaw: () => useStore.getState().content,
      preparePrint: async () => { await preparePrintDocument(sessions[0].snapshot, contexts[0]); },
      notes: entries => { notes.current = new Map(Object.entries(entries).map(([path, source]) => [path, new DocumentSession(path, source, undefined, async () => ({}))])); },
      changeNote: (path, source) => { notes.current.get(path)?.setText(source); },
      reset: (source, shared = true) => {
        setCanvas(false); links.current.length = 0; writes.current.length = 0;
        setModes(['live', 'reading']); setSecondary(true);
        setConfig((previous) => ({ source, shared, generation: previous.generation + 1 }));
      },
      cursor: (slot, from, to = from) => refs.current[slot]?.dispatch({ selection: { anchor: from, head: to } }),
      edit: (slot, changes) => refs.current[slot]?.dispatch({ changes }),
      source: (slot) => sessions[slot].snapshot.raw,
      crashPlugin: slot => {
        const view = refs.current[slot];
        view?.dispatch({ effects: StateEffect.appendConfig.of(ViewPlugin.fromClass(class {
          update() { throw new Error('controlled-plugin-fixture'); }
        })) });
        view?.dispatch({ selection: { anchor: view.state.selection.main.head } });
      },
      save: (slot) => sessions[slot].save(),
      undo: (slot) => { sessions[slot].undo(); },
      mode: (slot, mode) => setModes((previous) => previous.map((value, index) => index === slot ? mode : value)),
      focus: (slot) => refs.current[slot]?.focus(), closeSecondary: () => setSecondary(false),
      activeDocument: () => getActiveEditor()?.dom.closest('[data-document-id]')?.getAttribute('data-document-id') ?? null,
      format: fmtInline, links: links.current, writes: writes.current,
      coords: (slot, position) => {
        const rect = refs.current[slot]?.coordsAtPos(position);
        return rect ? { left: rect.left, top: rect.top } : null;
      },
      scroll: (slot, top) => { const view = refs.current[slot]; if (view) { view.scrollDOM.scrollTop = top; view.requestMeasure(); } },
    };
  }, [sessions]);
  if (canvas) return <div className="theme-light" style={{ width: 1000, height: 700 }}><CanvasView /></div>;
  return <><div className="theme-light" style={{ minHeight: '100vh', display: 'flex', gap: 12 }}>
    {sessions.map((session, slot) => (slot === 0 || secondary) &&
      <section key={config.generation + ':' + slot} data-slot={slot}
        style={{ width: 720, height: 700, display: 'flex', overflow: 'hidden', background: 'var(--background-primary)' }}>
        <HarnessView session={session} mode={modes[slot]} context={contexts[slot]} ready={(view) => {
          removers.current[slot]?.(); refs.current[slot] = view;
          removers.current[slot] = view ? registerEditor(view, { undo: () => session.undo(), redo: () => session.redo() }) : () => {};
        }} />
      </section>)}
  </div>{debugging && <div data-debug-panel className="theme-light"><DebugSettings /></div>}</>;
}
