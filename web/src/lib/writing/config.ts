import { useSyncExternalStore } from 'react';
import { api } from '../api';
import {
  DEFAULT_SETTINGS,
  processLatexSuiteSettings,
  type LatexSuiteCMSettings,
} from './latex/settings/settings';
import { parseSnippets, parseSnippetVariables } from './latex/snippets/parse';
import { parse } from 'valibot';
import { MappingSchema } from './latex/editor_extensions/conceal_maps';
import { mathlessArgsSchema } from './latex/editor_context/default_text_areas';

export interface WritingSettings {
  version: 1;
  migration: string;
  latex: Record<string, any>;
  linter: Record<string, any>;
  hotkeys: Record<string, { modifiers: string[]; key: string }[]>;
}
let settings: WritingSettings = { version: 1, migration: '', latex: {}, linter: {}, hotkeys: {} };
let cm = processLatexSuiteSettings(
  { ...DEFAULT_SETTINGS, matrixShortcutsEnabled: false, vimEnabled: false },
  { snippets: [], snippetVariables: {}, rawConcealMaps: [], updateHandlers: [] },
);
let revision = 0,
  generation = 0,
  load: Promise<void> | undefined;
let error = '';
const listeners = new Set<() => void>();
export const subscribeWriting = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
const changed = () => {
  revision++;
  listeners.forEach((fn) => fn());
};
export const writingSettings = () => settings;
export const writingCMSettings = (): LatexSuiteCMSettings => cm;
export function useWriting() {
  useSyncExternalStore(subscribeWriting, () => revision);
  return { settings, error };
}
async function request<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch('/api/writing' + url, {
    credentials: 'include',
    ...(body
      ? { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? `Writing settings: ${res.status}`);
  return res.json();
}
async function sources(
  kind: 'snippets' | 'variables',
  config: Record<string, any>,
): Promise<{ path: string; text: string }[]> {
  const enabled = kind === 'snippets' ? config.loadSnippetsFromFile : config.loadSnippetVariablesFromFile;
  if (!enabled)
    return [{ path: kind, text: String(config[kind === 'snippets' ? 'snippets' : 'snippetVariables']) }];
  const location = String(
    config[kind === 'snippets' ? 'snippetsFileLocation' : 'snippetVariablesFileLocation'] ?? '',
  );
  if (/^(?:[A-Za-z]:[\\/]|\/|~\/)/.test(location)) {
    const native = (window as any).webobsidianNativeRequire;
    if (!native) throw new Error('External snippet paths require the trusted desktop host');
    const fs = native('node:fs/promises'),
      path = native('node:path'),
      os = native('node:os');
    const values: { path: string; text: string }[] = [];
    const visit = async (p: string) => {
      const stat = await fs.stat(p);
      if (stat.isDirectory()) {
        for (const e of (await fs.readdir(p, { withFileTypes: true })).sort((a: any, b: any) =>
          a.name.localeCompare(b.name),
        )) {
          if (!e.isSymbolicLink() && (e.isDirectory() || /\.(js|mjs|md|markdown)$/.test(e.name)))
            await visit(path.join(p, e.name));
        }
      } else values.push({ path: p, text: await fs.readFile(p, 'utf8') });
    };
    await visit(location.startsWith('~/') ? path.join(os.homedir(), location.slice(2)) : location);
    return values;
  }
  const values: { path: string; text: string }[] = [];
  const visit = async (path: string) => {
    const { stat } = await api.pluginAdapter('stat', path);
    if (!stat) throw new Error('Rule file not found: ' + path);
    if (stat.type === 'folder') {
      const list = await api.pluginAdapter('list', path);
      for (const dir of list.folders.sort()) await visit(dir);
      for (const file of list.files.sort()) if (/\.(js|mjs|md|markdown)$/.test(file)) await visit(file);
    } else values.push({ path, text: (await api.pluginAdapter('read', path)).content });
  };
  await visit(location.replaceAll('\\', '/'));
  return values;
}
async function compile(next: WritingSettings) {
  const { compileFormattingSettings } = await import('./format');
  compileFormattingSettings(next.linter);
  const raw = {
    ...DEFAULT_SETTINGS,
    ...next.latex,
    matrixShortcutsEnabled: false,
    vimEnabled: false,
    excalidrawSupportEnabled: false,
  };
  const variables = Object.assign(
    {},
    ...(await Promise.all(
      (await sources('variables', raw)).map((s) => parseSnippetVariables(s.text, s.path)),
    )),
  );
  const maps: any[] = [],
    macros: any[] = [],
    handlers: any[] = [];
  const extensionApi = {
    addRawConcealMaps: (value: any) => {
      maps.push(parse(MappingSchema, value));
    },
    addMathlessMacros: (value: any) => {
      macros.push(parse(mathlessArgsSchema, value));
    },
    addUpdateHandler: (value: any) => handlers.push(value),
  };
  const snippets = [];
  // Sequential imports preserve script extension registration order.
  for (const source of await sources('snippets', raw))
    snippets.push(...(await parseSnippets(source.text, variables, source.path, extensionApi)));
  if (macros.length) {
    const configured = JSON.parse(raw.textMacros || '{"text":[],"restricted":[]}');
    for (const value of macros) {
      configured.text.push(...(value.text ?? []));
      configured.restricted.push(...(value.restricted ?? []));
    }
    raw.textMacros = JSON.stringify(configured);
  }
  return processLatexSuiteSettings(raw, {
    snippets,
    snippetVariables: variables,
    rawConcealMaps: maps,
    updateHandlers: handlers,
  });
}
export async function refreshWriting() {
  const current = ++generation;
  try {
    const next = await request<WritingSettings>('');
    const compiled = await compile(next);
    if (current !== generation) return;
    settings = next;
    cm = compiled;
    error = '';
    changed();
  } catch (cause) {
    if (current !== generation) return;
    error = String(cause);
    changed();
    throw cause;
  }
}
export function ensureWriting() {
  return (load ??= refreshWriting().catch((e) => {
    load = undefined;
    throw e;
  }));
}
let writes: Promise<unknown> = Promise.resolve();
export function updateWriting(patch: Partial<WritingSettings>) {
  writes = writes
    .catch(() => {})
    .then(async () => {
      const ruleConfigs = { ...settings.linter.ruleConfigs };
      for (const [id, value] of Object.entries(patch.linter?.ruleConfigs ?? {}))
        ruleConfigs[id] = { ...ruleConfigs[id], ...(value as object) };
      const next = {
        ...settings,
        ...patch,
        latex: { ...settings.latex, ...patch.latex },
        linter: { ...settings.linter, ...patch.linter, ruleConfigs },
      };
      const compiled = await compile(next);
      const persisted = await request<WritingSettings>('', patch);
      generation++;
      settings = persisted;
      cm = compiled;
      error = '';
      changed();
    });
  return writes;
}
export function writingFileChanged(path: string) {
  const raw = { ...DEFAULT_SETTINGS, ...settings.latex };
  const relevant = [
    raw.loadSnippetsFromFile ? raw.snippetsFileLocation : '',
    raw.loadSnippetVariablesFromFile ? raw.snippetVariablesFileLocation : '',
  ].filter(Boolean);
  if (relevant.some((p) => path === p || path.startsWith(p.replace(/\/$/, '') + '/')))
    void refreshWriting().catch(console.error);
}

/** Only external desktop files need an extra watcher; Vault files use existing fs events. */
export function watchExternalWritingSources() {
  let key = '',
    closers: (() => void)[] = [],
    timer: ReturnType<typeof setTimeout> | undefined;
  const setup = () => {
    const raw = { ...DEFAULT_SETTINGS, ...settings.latex };
    const paths = [
      raw.loadSnippetsFromFile ? raw.snippetsFileLocation : '',
      raw.loadSnippetVariablesFromFile ? raw.snippetVariablesFileLocation : '',
    ].filter((p) => /^(?:[A-Za-z]:[\\/]|\/|~\/)/.test(p));
    const next = JSON.stringify(paths);
    if (next === key) return;
    key = next;
    closers.forEach((fn) => fn());
    closers = [];
    const native = (window as any).webobsidianNativeRequire;
    if (!native) return;
    const fs = native('node:fs'),
      path = native('node:path'),
      os = native('node:os');
    for (const input of paths) {
      const p = input.startsWith('~/') ? path.join(os.homedir(), input.slice(2)) : input;
      try {
        const dir = fs.statSync(p).isDirectory();
        const watcher = fs.watch(
          dir ? p : path.dirname(p),
          { recursive: dir },
          (_event: string, name: string) => {
            if (!dir && name && String(name) !== path.basename(p)) return;
            clearTimeout(timer);
            timer = setTimeout(() => void refreshWriting().catch(console.error), 200);
          },
        );
        watcher.on('error', (cause: unknown) => console.error('Writing file watcher', cause));
        closers.push(() => watcher.close());
      } catch (cause) {
        console.error('Writing file watcher', cause);
      }
    }
  };
  const stop = subscribeWriting(setup);
  setup();
  return () => {
    stop();
    closers.forEach((fn) => fn());
    clearTimeout(timer);
  };
}
