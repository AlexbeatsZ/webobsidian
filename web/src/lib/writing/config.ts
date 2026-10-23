import { useSyncExternalStore } from 'react';
import { api } from '../api';
import {
  DEFAULT_SETTINGS,
  NATIVE_SNIPPETS_DIRECTORY,
  processLatexSuiteSettings,
  type LatexSuiteCMSettings,
} from './latex/settings/settings';
import { parseSnippets, parseSnippetVariables } from './latex/snippets/parse';
import { parse } from 'valibot';
import { MappingSchema } from './latex/editor_extensions/conceal_maps';
import { mathlessArgsSchema } from './latex/editor_context/default_text_areas';
import { mathArgumentInfo, mathBaseArguments, defaultMathConfiguration, type MathConfiguration } from '@webobsidian/markdown-core';
import type { VaultConfigurationSource } from '../../../../server/src/services/vaultConfiguration';
import { prepareMathProfile } from '../mathPreamble';
import { validateMathProfile, type MathCandidate } from '../mathjax';

export interface WritingSettings {
  version: 1;
  migration: string;
  latex: Record<string, any>;
  linter: Record<string, any>;
  hotkeys: Record<string, { modifiers: string[]; key: string }[]>;
  source?: VaultConfigurationSource;
  math?: MathConfiguration;
  mathSource?: VaultConfigurationSource;
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
const compiledInputs = new WeakMap<LatexSuiteCMSettings, string>();
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
    if (!native) throw new Error('外部片段路径需要可信桌面宿主');
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
    if (!stat) {
      if (kind === 'snippets' && path === NATIVE_SNIPPETS_DIRECTORY) return;
      throw new Error('找不到规则文件：' + path);
    }
    if (stat.type === 'folder') {
      const list = await api.pluginAdapter('list', path);
      for (const dir of list.folders.sort()) await visit(dir);
      for (const file of list.files.sort()) if (/\.(js|mjs|md|markdown)$/.test(file)) await visit(file);
    } else values.push({ path, text: (await api.pluginAdapter('read', path)).content });
  };
  await visit(location.replaceAll('\\', '/'));
  return values;
}
async function compile(next: WritingSettings, commands: readonly string[], force = false) {
  const { compileFormattingSettings } = await import('./format');
  if (force || JSON.stringify(next.linter) !== JSON.stringify(settings.linter)) compileFormattingSettings(next.linter);
  const inputKey = JSON.stringify([next.latex, commands, (next.math ?? defaultMathConfiguration()).packages]);
  if (!force && inputKey === compiledInputs.get(cm)) return cm;
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
    commandNames: commands,
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
  const packageArguments = mathArgumentInfo((next.math ?? defaultMathConfiguration()).packages);
  macros.push({ text: [], restricted: Object.entries(packageArguments).flatMap(([name, args]) => {
    // Base argument modes are already applied by the settings compiler.
    if (args === mathBaseArguments[name]) return [];
    const indexes = args.flatMap((kind, i) => kind === 'literal' || kind === 'chemistry' || kind === 'unit' ? [i] : []);
    return indexes.length ? [{ name, arguments: indexes }] : [];
  }) });
  if (macros.length) {
    const configured = JSON.parse(raw.textMacros || '{"text":[],"restricted":[]}');
    for (const value of macros) {
      configured.text.push(...(value.text ?? []));
      configured.restricted.push(...(value.restricted ?? []));
    }
    raw.textMacros = JSON.stringify(configured);
  }
  const result = processLatexSuiteSettings(raw, {
    snippets,
    snippetVariables: variables,
    rawConcealMaps: maps,
    updateHandlers: handlers,
  });
  compiledInputs.set(result, inputKey);
  return result;
}
export async function refreshWriting(forceRules = false) {
  const current = ++generation;
  let candidate: MathCandidate | undefined;
  try {
    const next = await request<WritingSettings>('');
    candidate = await validateMathProfile(await prepareMathProfile(next.math));
    // JSON responses create new objects. Reuse unchanged slices to avoid running
    // snippet modules again when only Linter or math source metadata changed.
    if (JSON.stringify(next.math) === JSON.stringify(settings.math)) next.math = settings.math;
    const compiled = await compile(next, candidate.commands, forceRules);
    if (current !== generation) { candidate.dispose(); return; }
    settings = next;
    cm = compiled;
    candidate.commit();
    error = '';
    changed();
  } catch (cause) {
    candidate?.dispose();
    if (current !== generation) return;
    error = `配置加载失败，新配置未应用：${String(cause)}`;
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
      const startingGeneration = ++generation;
      try {
        if (patch.math && Object.keys(patch).some(key => key !== 'math')) throw new Error('请单独保存公式设置');
        const ruleConfigs = { ...settings.linter.ruleConfigs };
        for (const [id, value] of Object.entries(patch.linter?.ruleConfigs ?? {}))
          ruleConfigs[id] = { ...ruleConfigs[id], ...(value as object) };
        const next = {
          ...settings,
          ...patch,
          latex: { ...settings.latex, ...patch.latex },
          linter: { ...settings.linter, ...patch.linter, ruleConfigs },
        };
        const candidate = await validateMathProfile(await prepareMathProfile(next.math));
        let persisted: WritingSettings, compiled: LatexSuiteCMSettings;
        try {
          compiled = await compile(next, candidate.commands);
          persisted = await request<WritingSettings>('', patch.math ? { math: patch.math, mathSource: settings.mathSource } : { ...patch, source: settings.source });
        } catch (cause) { candidate.dispose(); throw cause; }
        if (generation !== startingGeneration) {
          candidate.dispose();
          await refreshWriting();
          return;
        }
        generation++;
        settings = persisted;
        cm = compiled;
        candidate.commit();
        error = '';
        changed();
      } catch (cause) {
        if (generation === startingGeneration) {
          error = `此次保存未生效：${String(cause)}`;
          changed();
        }
        throw cause;
      }
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
    void refreshWriting(true).catch(console.error);
  else if (path === '.obsidian/webobsidian/writing.jsonc' || path === '.obsidian/webobsidian/math.jsonc' || path === settings.math?.preambleFile)
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
            timer = setTimeout(() => void refreshWriting(true).catch(console.error), 200);
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
