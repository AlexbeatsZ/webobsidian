import './linter/register';
import moment from 'moment';
import log from 'loglevel';
import { rules } from './linter/rules';
import { RulesRunner, createRunLinterRulesOptions } from './linter/rules-runner';
import { DEFAULT_SETTINGS } from './linter/settings-data';
import { parseCustomReplacements } from './linter/utils/strings';
import { setLanguage } from './linter/lang/helpers';
import { api } from '../api';
import { writingSettings, ensureWriting, subscribeWriting } from './config';
import { useWritingModel } from './analysis';
import {
  changesBetween,
  compileReplacement,
  replacementCallback,
  REPLACEMENT_SYNTAX,
  type DocumentSession,
} from '@webobsidian/markdown-core';
import { documents } from '../documents';
import { getEditorForPath } from '../activeEditor';
import { writingOperation, snippetChangeEffects } from './editing';

export const formatRules = rules;
let compiledSource: unknown, compiled: any;
let correctionCache = new Map<string, { text: string; map: Map<string, string> }>();
let defaults: Map<string, string> | undefined;
const formattedVersions = new WeakMap<DocumentSession, number>();
export function compileFormattingSettings(raw: Record<string, any>) {
  if (raw.replacementSyntax !== undefined && raw.replacementSyntax !== REPLACEMENT_SYNTAX)
    throw new Error('Unsupported replacement syntax: ' + raw.replacementSyntax);
  for (const key of ['ruleConfigs', 'commonStyles'])
    if (raw[key] !== undefined && (!raw[key] || typeof raw[key] !== 'object' || Array.isArray(raw[key])))
      throw new Error(`Invalid formatter ${key}`);
  for (const key of [
    'customRegexes',
    'foldersToIgnore',
    'filesToIgnore',
    'lintCommands',
    'additionalFileExtensions',
  ])
    if (raw[key] !== undefined && !Array.isArray(raw[key])) throw new Error(`Invalid formatter ${key}`);
  for (const value of raw.foldersToIgnore ?? [])
    if (typeof value !== 'string') throw new Error('Ignored folders must be paths');
  for (const value of raw.filesToIgnore ?? []) if (value.match) new RegExp(value.match, value.flags);
  setLanguage('zh-CN');
  const ruleConfigs = Object.fromEntries(
    rules.map((rule) => [rule.alias, { ...rule.getDefaultOptions(), ...raw.ruleConfigs?.[rule.alias] }]),
  );
  const customRegexes = (raw.customRegexes ?? []).map((value: any) => ({
    ...value,
    regex: value.enabled && value.find ? new RegExp(value.find, value.flags) : null,
    replacement: replacementCallback(compileReplacement(value.replace ?? '')),
  }));
  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    ruleConfigs,
    customRegexes,
    commonStyles: { ...DEFAULT_SETTINGS.commonStyles, ...raw.commonStyles },
  };
}
export function formatterSettings() {
  const raw = writingSettings().linter;
  if (raw === compiledSource) return compiled;
  compiled = compileFormattingSettings(raw);
  compiledSource = raw;
  return compiled;
}
export function ignoresFormatting(path: string, settings = formatterSettings()) {
  return (
    !(
      /\.(md|markdown)$/i.test(path) ||
      (settings.additionalFileExtensions ?? []).some((e: string) => path.endsWith('.' + e))
    ) ||
    settings.foldersToIgnore.some(
      (p: string) => p && path.startsWith(p.replace(/\\/g, '/').replace(/\/$/, '') + '/'),
    ) ||
    settings.filesToIgnore.some((p: any) => p.match && new RegExp(p.match, p.flags).test(path))
  );
}
function runOptions(
  text: string,
  path: string,
  stat: { ctime?: number; mtime?: number },
  settings: any,
  now = Date.now(),
) {
  const locale =
    settings.linterLocale === 'system-default'
      ? typeof navigator === 'undefined'
        ? 'en'
        : navigator.language || 'en'
      : settings.linterLocale;
  setLanguage('zh-CN');
  log.setLevel(settings.logLevel?.toLowerCase() ?? 'error');
  const file = {
    path,
    basename: path
      .split('/')
      .pop()
      ?.replace(/\.[^.]+$/, ''),
    stat: { ctime: stat.ctime || now, mtime: stat.mtime || now },
  };
  const options = createRunLinterRulesOptions(text, file, locale, settings, defaults ?? new Map());
  options.getCurrentTime = () => moment(now).locale(locale);
  return options;
}
export function formatText(
  text: string,
  path: string,
  stat: { ctime?: number; mtime?: number } = {},
  settings = formatterSettings(),
  now = Date.now(),
) {
  if (ignoresFormatting(path, settings)) return text;
  return new RulesRunner().lintText(runOptions(text, path, stat, settings, now));
}
export function formatPaste(text: string, path: string, line: string, selected: string) {
  const settings = formatterSettings();
  if (ignoresFormatting(path, settings)) return text;
  return new RulesRunner().runPasteLint(line, selected, runOptions(text, path, {}, settings));
}
async function prepareCorrections(settings: any) {
  const config = settings.ruleConfigs['auto-correct-common-misspellings'];
  if (!config?.enabled) return settings;
  defaults ??= parseCustomReplacements((await import('./linter/utils/default-misspellings.md?raw')).default);
  const files = [];
  for (const file of config['extra-auto-correct-files'] ?? []) {
    if (!file.filePath) continue;
    const { content } = await api.pluginAdapter('read', file.filePath);
    let cached = correctionCache.get(file.filePath);
    if (cached?.text !== content) {
      cached = { text: content, map: parseCustomReplacements(content) };
      correctionCache.set(file.filePath, cached);
    }
    files.push({ ...file, customReplacements: cached!.map });
  }
  return {
    ...settings,
    ruleConfigs: {
      ...settings.ruleConfigs,
      'auto-correct-common-misspellings': { ...config, 'extra-auto-correct-files': files },
    },
  };
}
export async function formatSession(session: DocumentSession, timestampOnly = false) {
  if (session.snapshot.conflict) throw new Error('Resolve the external file conflict before formatting');
  const settings = timestampOnly ? formatterSettings() : await prepareCorrections(formatterSettings());
  if (ignoresFormatting(session.id, settings)) return false;
  const { stat } = await api.pluginAdapter('stat', session.id);
  // Use the latest snapshot after async reads, never the one before them.
  const snapshot = session.snapshot;
  if (snapshot.conflict) throw new Error('Document has an external conflict');
  useWritingModel(session.analysis);
  const options = runOptions(snapshot.text, session.id, stat ?? {}, settings);
  (options as any).userModified = session.userEditVersion > (formattedVersions.get(session) ?? 0);
  const runner = new RulesRunner();
  const after = timestampOnly ? runner.runYAMLTimestampByItself(options) : runner.lintText(options);
  if (snapshot.version !== session.snapshot.version)
    throw new Error('Document changed during formatting; save again');
  const changes = changesBetween(snapshot.text, after);
  if (!changes.length) {
    formattedVersions.set(session, session.userEditVersion);
    return false;
  }
  const view = getEditorForPath(session.id);
  if (view && !view.state.readOnly && view.state.doc.toString() === snapshot.text) {
    view.dispatch({
      changes,
      effects: snippetChangeEffects(view.state, changes),
      annotations: writingOperation.of('format'),
      userEvent: 'input.format',
    });
  } else session.edit(snapshot.version, changes, 'format');
  formattedVersions.set(session, session.userEditVersion);
  return true;
}

const timestampBindings = new WeakMap<DocumentSession, { users: number; stop: () => void }>();
/** One optional timestamp timer per session, even when the note has several views. */
export function bindTimestampUpdates(session: DocumentSession, report: (error: string) => void) {
  let binding = timestampBindings.get(session);
  if (!binding) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let handled = session.userEditVersion;
    let running = false;
    let active = true;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      if (!active || running || handled === session.userEditVersion || session.snapshot.conflict) return;
      const settings = formatterSettings(),
        rule = settings.ruleConfigs['yaml-timestamp'];
      const delays: Record<string, number> = {
        'after 5 seconds': 5000,
        'after 10 seconds': 10000,
        'after 15 seconds': 15000,
        'after 30 seconds': 30000,
        'after 1 minute': 60000,
      };
      const delay = delays[rule?.['update-on-file-contents-updated']];
      if (!rule?.enabled || !delay || ignoresFormatting(session.id, settings)) return;
      timer = setTimeout(async () => {
        timer = undefined;
        const view = getEditorForPath(session.id);
        if (view?.composing) {
          schedule();
          return;
        }
        if (view?.state.readOnly) return;
        running = true;
        const version = session.userEditVersion;
        try {
          await formatSession(session, true);
          handled = version;
        } catch (error) {
          handled = version;
          report(String(error));
        } finally {
          running = false;
          schedule();
        }
      }, delay);
    };
    const stopSession = session.subscribe(schedule),
      stopSettings = subscribeWriting(schedule);
    binding = {
      users: 0,
      stop: () => {
        active = false;
        stopSession();
        stopSettings();
        if (timer) clearTimeout(timer);
      },
    };
    timestampBindings.set(session, binding);
  }
  binding.users++;
  return () => {
    if (--binding.users === 0) {
      binding.stop();
      timestampBindings.delete(session);
    }
  };
}
const inFlight = new Map<string, { promise: Promise<void>; requested: boolean }>();
export function manualSave(path: string) {
  const existing = inFlight.get(path);
  if (existing) {
    existing.requested = true;
    return existing.promise;
  }
  const current = { promise: Promise.resolve(), requested: true };
  const promise = (async () => {
    await ensureWriting();
    const session = documents.get(path) ?? (await documents.open(path));
    if (getEditorForPath(path)?.state.readOnly) {
      await session.save();
      return;
    }
    while (current.requested) {
      current.requested = false;
      if (formatterSettings().lintOnSave) await formatSession(session);
      await session.save();
    }
    if (formatterSettings().lintOnSave) await runAfterCommands();
  })().finally(() => inFlight.delete(path));
  current.promise = promise;
  inFlight.set(path, current);
  return promise;
}
export async function runAfterCommands() {
  const commands = formatterSettings().lintCommands ?? [];
  const ids = new Set<string>();
  for (const command of commands)
    if (command.enabled && command.id && !ids.has(command.id)) {
      ids.add(command.id);
      if (command.id.startsWith('obsidian-linter:') || command.id === 'editor:save-file')
        throw new Error('Recursive formatting command blocked: ' + command.id);
      const { sharedApp } = await import('../plugins');
      if (!sharedApp.commands.executeCommandById(command.id))
        throw new Error('Unknown formatting command: ' + command.id);
    }
}
export async function formatPath(path: string, save = false) {
  await ensureWriting();
  const session = documents.get(path) ?? (await documents.open(path));
  const changed = await formatSession(session);
  if (save) await session.save();
  return changed;
}
