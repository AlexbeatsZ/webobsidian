import { promises as fs } from 'node:fs';
import path from 'node:path';
import { migrateLinterReplacements, REPLACEMENT_SYNTAX } from '@webobsidian/markdown-core';
import { getSettings, updateSettings } from './settings.js';
import { resolveInVault } from './vault.js';
import { readMathConfiguration } from './mathSettings.js';
import { applyEdits, modify } from 'jsonc-parser';
import { z } from 'zod';
import { readVaultConfiguration, writeVaultConfiguration, parseConfiguration, type VaultConfigurationSource } from './vaultConfiguration.js';

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
  const source = await readVaultConfiguration('writing.jsonc');
  const value: WritingSettings = source.exists
    ? WritingConfigurationSchema.parse(parseConfiguration(source.content))
    : await storedWritingSettings();
  const math = await readMathConfiguration();
  return { ...value, source, math: math.configuration, mathSource: math.source };
}
const WritingConfigurationSchema = z.object({
  version: z.literal(1), migration: z.string().default(''),
  latex: z.record(z.unknown()), linter: z.record(z.unknown()),
  hotkeys: z.record(z.array(z.object({ modifiers: z.array(z.string()), key: z.string() }))).default({}),
}).strict().transform(value => ({ ...value, linter: migrateLinterReplacements(value.linter) }));
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
  expected?: VaultConfigurationSource,
) {
  const key = path.resolve((await getSettings()).vault.path);
  const settings = await writingSettings();
  if (path.resolve((await getSettings()).vault.path) !== key) throw new Error('Vault changed');
  if (expected && (expected.path !== 'writing.jsonc' || expected.vault !== settings.source.vault ||
      expected.exists !== settings.source.exists || expected.revision !== settings.source.revision))
    throw Object.assign(new Error('写作配置已在外部改变，请重新加载后再保存'), { status: 409 });
  if (patch.linter?.replacementSyntax !== undefined && patch.linter.replacementSyntax !== REPLACEMENT_SYNTAX)
    throw new Error('Only LaTeX Suite replacement syntax is supported');
  const ruleConfigs = { ...settings.linter.ruleConfigs };
  for (const [id, value] of Object.entries(patch.linter?.ruleConfigs ?? {}))
    ruleConfigs[id] = { ...ruleConfigs[id], ...(value as object) };
  const next = WritingConfigurationSchema.parse({
    version: settings.version, migration: settings.migration,
    hotkeys: patch.hotkeys ?? settings.hotkeys,
    latex: { ...settings.latex, ...patch.latex },
    linter: { ...settings.linter, ...patch.linter, ruleConfigs },
  });
  let content = settings.source.content || '{}';
  for (const [field, value] of Object.entries(next))
    content = applyEdits(content, modify(content, [field], value, { formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' } }));
  const source = await writeVaultConfiguration({ ...settings.source, content });
  return { ...next, source };
}
