import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { DocumentSession, type SourceChange } from '@webobsidian/markdown-core';
import type { EditorView } from '@codemirror/view';
import MarkdownView, { type MarkdownMode } from '../components/MarkdownView';
import { registerEditor, getActiveEditor, fmtInline } from '../lib/activeEditor';
import type { RenderContext } from '../lib/renderContext';

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
  const [config, setConfig] = useState({ source: '# Title\n\n**bold** and plain.\n\nCaret sentinel.', shared: true, generation: 0 });
  const [modes, setModes] = useState<MarkdownMode[]>(['live', 'reading']);
  const [secondary, setSecondary] = useState(true);
  const refs = useRef<(EditorView | null)[]>([]);
  const removers = useRef<(() => void)[]>([]);
  const links = useRef<string[]>([]);
  const writes = useRef<string[]>([]);
  const sessions = useMemo(() => {
    const writer = async (_id: string, raw: string) => { writes.current.push(raw); return { revision: String(writes.current.length) }; };
    const a = new DocumentSession('a.md', config.source, 'r0', writer);
    return [a, config.shared ? a : new DocumentSession('b.md', config.source, 'r0', writer)];
  }, [config]);
  const contexts = useMemo(() => sessions.map((session, slot): RenderContext => ({
    sourcePath: session.id, openLink: (target) => { links.current.push(slot + ':' + target); }, openMenu: () => {},
    rawUrl: (target) => target, files: () => [], tags: async () => [], properties: async () => [],
    propertyTypes: () => ({}), setPropertyType: async () => ({}), renderEmbed: async () => null,
  })), [sessions]);
  useEffect(() => {
    window.renderHarness = {
      reset: (source, shared = true) => {
        links.current.length = 0; writes.current.length = 0;
        setModes(['live', 'reading']); setSecondary(true);
        setConfig((previous) => ({ source, shared, generation: previous.generation + 1 }));
      },
      cursor: (slot, from, to = from) => refs.current[slot]?.dispatch({ selection: { anchor: from, head: to } }),
      edit: (slot, changes) => refs.current[slot]?.dispatch({ changes }),
      source: (slot) => sessions[slot].snapshot.raw,
      save: (slot) => sessions[slot].save(),
      undo: (slot) => { sessions[slot].undo(); },
      mode: (slot, mode) => setModes((previous) => previous.map((value, index) => index === slot ? mode : value)),
      focus: (slot) => refs.current[slot]?.focus(), closeSecondary: () => setSecondary(false),
      activeDocument: () => getActiveEditor()?.dom.closest('[data-document-id]')?.getAttribute('data-document-id') ?? null,
      format: fmtInline, links: links.current, writes: writes.current,
    };
  }, [sessions]);
  return <div className="theme-light" style={{ minHeight: '100vh', display: 'flex', gap: 12 }}>
    {sessions.map((session, slot) => (slot === 0 || secondary) &&
      <section key={config.generation + ':' + slot} data-slot={slot}
        style={{ width: 720, height: 700, display: 'flex', overflow: 'hidden', background: 'var(--background-primary)' }}>
        <HarnessView session={session} mode={modes[slot]} context={contexts[slot]} ready={(view) => {
          removers.current[slot]?.(); refs.current[slot] = view;
          removers.current[slot] = view ? registerEditor(view, { undo: () => session.undo(), redo: () => session.redo() }) : () => {};
        }} />
      </section>)}
  </div>;
}
