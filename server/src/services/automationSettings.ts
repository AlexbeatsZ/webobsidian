import { AutomationSchema, type AutomationSettings } from '../contracts/automation.js';
export { AutomationSchema, type AutomationSettings } from '../contracts/automation.js';
import { modify, applyEdits } from 'jsonc-parser';
import { readVaultConfiguration, writeVaultConfiguration, parseConfiguration, type VaultConfigurationSource } from './vaultConfiguration.js';
import { getSettings } from './settings.js';
import path from 'node:path';


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
