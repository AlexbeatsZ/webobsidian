import { promises as fs } from 'node:fs';
import { z } from 'zod';
import { modify, applyEdits } from 'jsonc-parser';
import { normalizeMathConfiguration, defaultMathConfiguration, type MathConfiguration } from '@webobsidian/markdown-core';
import { readVaultConfiguration, writeVaultConfiguration, parseConfiguration, type VaultConfigurationSource } from './vaultConfiguration.js';
import { resolveInVault } from './vault.js';

export const MathConfigurationSchema = z.object({
  version: z.literal(1), packages: z.array(z.string().min(1).max(80)).max(64),
  packageOptions: z.record(z.record(z.unknown())), preambleFile: z.string().max(4096),
  preamble: z.string().max(262144), migration: z.string().max(1024),
}).strict();
const readLegacy = async (file: string) => {
  try { return JSON.parse(await fs.readFile(await resolveInVault('.obsidian/' + file), 'utf8')); }
  catch (cause: any) { if (cause.code === 'ENOENT') return undefined; throw cause; }
};
/** Data-only defaults. Loading never writes the Vault or changes old plugin files. */
export async function readMathConfiguration() {
  const source = await readVaultConfiguration('math.jsonc');
  let value: MathConfiguration;
  if (source.exists) value = normalizeMathConfiguration(MathConfigurationSchema.parse(parseConfiguration(source.content)));
  else {
    value = defaultMathConfiguration();
    const enabled = await readLegacy('community-plugins.json') ?? [];
    if (enabled.includes('local-latex-renderer')) {
      const local = await readLegacy('plugins/local-latex-renderer/data.json');
      if (typeof local?.mathJaxPreamble === 'string') {
        value.preamble = local.mathJaxPreamble;
        value.migration = 'Imported local-latex-renderer MathJax preamble';
      }
    } else if (enabled.includes('obsidian-latex')) {
      const old = await readLegacy('plugins/obsidian-latex/data.json');
      value.preambleFile = typeof old?.preamblePath === 'string' ? old.preamblePath : 'preamble.sty';
      value.migration = 'Imported Extended MathJax preamble path';
    }
  }
  return { source, configuration: value };
}
export async function saveMathConfiguration(source: VaultConfigurationSource, input: unknown) {
  if (source.path !== 'math.jsonc') throw new Error('Invalid math configuration path');
  const configuration = normalizeMathConfiguration(MathConfigurationSchema.parse(input));
  let content = source.content || '{}';
  for (const [key, value] of Object.entries(configuration))
    content = applyEdits(content, modify(content, [key], value, { formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' } }));
  return { source: await writeVaultConfiguration({ ...source, content }), configuration };
}
