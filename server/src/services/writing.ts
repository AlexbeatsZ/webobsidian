import { promises as fs } from 'node:fs';
import path from 'node:path';
import { migrateLinterReplacements, REPLACEMENT_SYNTAX } from '@webobsidian/markdown-core';
import { getSettings, updateSettings } from './settings.js';
import { resolveInVault } from './vault.js';
import { readMathConfiguration } from './mathSettings.js';

export interface WritingSettings {
  version: 1;
  migration: string;
  latex: Record<string, any>;
  linter: Record<string, any>;
  hotkeys: Record<string, { modifiers: string[]; key: string }[]>;
}
const migrating = new Map<string, Promise<WritingSettings>>();
async function storedWritingSettings(): Promise<WritingSettings> {
  const settings = await getSettings(),
    key = path.resolve(settings.vault.path);
  const current = settings.writing[key] as WritingSettings | undefined;
  if (current?.linter.replacementSyntax === REPLACEMENT_SYNTAX) return current;
  let operation = migrating.get(key);
  if (!operation) {
    operation = migrate(key, current).finally(() => migrating.delete(key));
    migrating.set(key, operation);
  }
  return operation;
}
export async function writingSettings() {
  const value = await storedWritingSettings();
  const math = await readMathConfiguration();
  return { ...value, math: math.configuration, mathSource: math.source };
}
async function migrate(key: string, current?: WritingSettings): Promise<WritingSettings> {
  if (current) {
    const updated = await updateSettings((d) => {
      if (path.resolve(d.vault.path) !== key) throw new Error('Vault changed during writing migration');
      const saved = d.writing[key] as WritingSettings;
      d.writing[key] = { ...saved, linter: migrateLinterReplacements(saved.linter) };
    });
    return updated.writing[key] as WritingSettings;
  }
  const read = async (file: string) => {
    try {
      return JSON.parse(await fs.readFile(await resolveInVault('.obsidian/' + file), 'utf8'));
    } catch (e: any) {
      if (e.code === 'ENOENT') return {};
      throw new Error(`Cannot import ${file}: ${e.message}`);
    }
  };
  const [latex, linter, hotkeys] = await Promise.all([
    read('plugins/obsidian-latex-suite/data.json'),
    read('plugins/obsidian-linter/data.json'),
    read('hotkeys.json'),
  ]);
  if (![latex, linter, hotkeys].every((x) => x && typeof x === 'object' && !Array.isArray(x)))
    throw new Error('Invalid legacy writing settings');
  const next: WritingSettings = {
    version: 1,
    migration: 'Imported LaTeX Suite / Linter configuration',
    latex: {
      ...latex,
      concealEnabled: false,
      matrixShortcutsEnabled: false,
      vimEnabled: false,
      excalidrawSupportEnabled: false,
      mathPreviewEnabled: true,
      mathPreviewBracketHighlighting: true,
      mathPreviewLivePreviewDisplay: true,
      highlightDollarEnabled: true,
    },
    linter: migrateLinterReplacements(linter),
    hotkeys: Object.fromEntries(
      Object.entries(hotkeys).filter(
        ([id]) => id.startsWith('obsidian-latex-suite:') || id.startsWith('obsidian-linter:'),
      ),
    ) as WritingSettings['hotkeys'],
  };
  const updated = await updateSettings((d) => {
    if (path.resolve(d.vault.path) !== key) throw new Error('Vault changed during writing migration');
    d.writing[key] ??= next;
  });
  return updated.writing[key] as WritingSettings;
}
export async function saveWritingSettings(
  patch: Partial<Pick<WritingSettings, 'latex' | 'linter' | 'hotkeys'>>,
) {
  const key = path.resolve((await getSettings()).vault.path);
  const settings = await writingSettings();
  if (path.resolve((await getSettings()).vault.path) !== key) throw new Error('Vault changed');
  if (patch.linter?.replacementSyntax !== undefined && patch.linter.replacementSyntax !== REPLACEMENT_SYNTAX)
    throw new Error('Only LaTeX Suite replacement syntax is supported');
  const result = await updateSettings((d) => {
    if (path.resolve(d.vault.path) !== key) throw new Error('Vault changed');
    const current = (d.writing[key] as WritingSettings) ?? settings;
    const ruleConfigs = { ...current.linter.ruleConfigs };
    for (const [id, value] of Object.entries(patch.linter?.ruleConfigs ?? {}))
      ruleConfigs[id] = { ...ruleConfigs[id], ...(value as object) };
    d.writing[key] = {
      ...current,
      ...patch,
      latex: { ...current.latex, ...patch.latex },
      linter: { ...current.linter, ...patch.linter, ruleConfigs },
    };
  });
  return result.writing[key];
}
