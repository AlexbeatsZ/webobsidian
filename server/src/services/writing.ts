import { REPLACEMENT_SYNTAX } from '@webobsidian/markdown-core';
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
export async function writingSettings() {
  const source = await readVaultConfiguration('writing.jsonc');
  const value: WritingSettings = source.exists
    ? WritingConfigurationSchema.parse(parseConfiguration(source.content))
    : { version: 1, migration: '', latex: {}, linter: { replacementSyntax: REPLACEMENT_SYNTAX }, hotkeys: {} };
  const math = await readMathConfiguration();
  return { ...value, source, math: math.configuration, mathSource: math.source };
}
const WritingConfigurationSchema = z.object({
  version: z.literal(1), migration: z.string().default(''),
  latex: z.record(z.unknown()), linter: z.record(z.unknown()),
  hotkeys: z.record(z.array(z.object({ modifiers: z.array(z.string()), key: z.string() }))).default({}),
}).strict().transform(value => ({ ...value, linter: { replacementSyntax: REPLACEMENT_SYNTAX, ...value.linter } }))
  .refine(value => value.linter.replacementSyntax === REPLACEMENT_SYNTAX, { message: '写作配置需要 replacementSyntax: latex-suite-v1' });
export async function saveWritingSettings(
  patch: Partial<Pick<WritingSettings, 'latex' | 'linter' | 'hotkeys'>>,
  expected?: VaultConfigurationSource,
) {
  const settings = await writingSettings();
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

/** Explicit creation only; the source file is never seeded from personal plugins. */
export async function createNativeSnippets(vault: string) {
  const source = await readVaultConfiguration('snippets/snippets.js', vault, ['.js']);
  if (source.exists) return source;
  return writeVaultConfiguration({ ...source, content: 'export default [];\n' }, ['.js']);
}
