import { z } from 'zod';
import { parseConfiguration, readVaultConfiguration } from './vaultConfiguration.js';

const asset = (extension: string) => z.string().max(200).refine(value =>
  value.endsWith(extension) && value.split('/').every(part => /^[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/.test(part) && !part.endsWith('.')), 'Invalid block asset path');
const definition = z.object({
  names: z.array(z.string().min(1).max(160).regex(/^[^\[\]|\r\n]+$/)).min(1).max(32),
  classes: z.array(z.string().regex(/^-?[_a-zA-Z]+[_a-zA-Z0-9-]*$/)).max(32).default([]),
  stylesheet: asset('.css').optional(), script: asset('.js').optional(),
}).strict();
export const BlockEffectsSchema = z.object({ version: z.literal(1), definitions: z.array(definition).max(256) }).strict()
  .superRefine((value, ctx) => {
    const names = value.definitions.flatMap(d => d.names);
    if (new Set(names).size !== names.length) ctx.addIssue({ code: 'custom', message: 'Duplicate block effect name' });
  });

/** Missing configuration is inert. Reading never installs defaults or legacy code. */
export async function readBlockEffects(expectedVault?: string) {
  const source = await readVaultConfiguration('blocks/blocks.jsonc', expectedVault);
  const settings = source.exists ? BlockEffectsSchema.parse(parseConfiguration(source.content)) : { version: 1, definitions: [] };
  const files = new Map<string, string>();
  for (const file of new Set(settings.definitions.flatMap(d => [d.stylesheet, d.script].filter((s): s is string => !!s)))) {
    const asset = await readVaultConfiguration('blocks/' + file, source.vault, ['.css', '.js']);
    if (!asset.exists) throw new Error('Block effect file is missing: ' + file);
    files.set(file, asset.content);
  }
  return { vault: source.vault, path: '.obsidian/webobsidian/blocks/blocks.jsonc', definitions: settings.definitions.map(d => ({
    names: d.names, classes: d.classes, script: d.script,
    code: d.script ? files.get(d.script) : undefined, css: d.stylesheet ? files.get(d.stylesheet) : undefined,
  })) };
}
