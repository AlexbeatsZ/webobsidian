import { z } from 'zod';
import { modify, applyEdits } from 'jsonc-parser';
import { readVaultConfiguration, writeVaultConfiguration, parseConfiguration, type VaultConfigurationSource } from './vaultConfiguration.js';
import { getSettings } from './settings.js';
import path from 'node:path';

// Shared persisted shape; the browser imports the inferred type only.
export const AutomationSchema = z.object({
  version: z.literal(1).default(1),
  commands: z.array(z.object({
    id: z.string().regex(/^user:[a-zA-Z0-9][a-zA-Z0-9:_-]*$/).max(160),
    name: z.string().min(1).max(200), code: z.string().max(262144), enabled: z.boolean().default(true),
  }).strict()).max(256).default([]),
  templates: z.object({
    folder: z.string().max(4096).default(''),
    bindings: z.array(z.object({ id: z.string().regex(/^template:[a-zA-Z0-9][a-zA-Z0-9:_-]*$/),
      name: z.string().min(1), path: z.string().min(1) }).strict()).max(256).default([]),
    folderRules: z.array(z.object({ folder: z.string(), template: z.string().min(1) }).strict()).max(128).default([]),
  }).strict().default({}),
}).strict().superRefine((value, ctx) => {
  const ids = [...value.commands, ...value.templates.bindings].map(c => c.id);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'Duplicate command ID' });
  const paths = [value.templates.folder, ...value.templates.bindings.map(item => item.path),
    ...value.templates.folderRules.flatMap(rule => [rule.folder, rule.template])];
  if (paths.some(value => value.startsWith('/') || value.includes('\\') || value.includes(':') ||
      value.split('/').some(part => part === '..' || part === '.')))
    ctx.addIssue({ code: 'custom', message: 'Use Vault-relative paths without parent traversal' });
  if ([...value.templates.bindings.map(item => item.path), ...value.templates.folderRules.map(rule => rule.template)]
      .some(value => !/\.(md|markdown)$/i.test(value))) ctx.addIssue({ code: 'custom', message: 'Template paths must address Markdown files' });
}).default({});
export type AutomationSettings = z.infer<typeof AutomationSchema>;

export async function readAutomationConfiguration() {
  const source = await readVaultConfiguration('automation.jsonc');
  const parsed = source.exists ? parseConfiguration(source.content) : {};
  const result = AutomationSchema.safeParse(parsed);
  if (!result.success) throw Object.assign(new Error(`automation.jsonc：${result.error.issues.map(issue => issue.path.join('.') + ' ' + issue.message).join('; ')}`), { status: 400 });
  const settings = result.data;
  return { source, settings };
}
export async function saveAutomationConfiguration(input: { source: VaultConfigurationSource; settings: AutomationSettings }) {
  const settings = AutomationSchema.parse(input.settings);
  if (input.source.path !== 'automation.jsonc') throw Object.assign(new Error('Invalid automation path'), { status: 400 });
  let content = input.source.content || '{}';
  const options = { formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' } };
  for (const [key, value] of Object.entries(settings)) content = applyEdits(content, modify(content, [key], value, options));
  const source = await writeVaultConfiguration({ ...input.source, content });
  return { source, settings };
}
/** Explicit, preserved-source migration; reading defaults never writes a Vault. */
export async function importAutomationConfiguration(source: VaultConfigurationSource) {
  if (source.exists) throw Object.assign(new Error('Configuration already exists; original file preserved'), { status: 409 });
  const legacy = await getSettings(), root = path.resolve(legacy.vault.path);
  const key = process.platform === 'win32' ? root.toLowerCase() : root;
  const old = AutomationSchema.parse(legacy.nativeFeatures[key]?.automation ?? {});
  const settings = AutomationSchema.parse({ ...old, templates: { ...old.templates,
    folder: old.templates.folder || legacy.search.chinese.templateFolder } });
  return saveAutomationConfiguration({ source, settings });
}
