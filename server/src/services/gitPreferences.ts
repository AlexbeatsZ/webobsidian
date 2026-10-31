import { GitPreferencesSchema } from '../contracts/gitPreferences.js';
import { parseConfiguration, readVaultConfiguration, writeVaultConfiguration } from './vaultConfiguration.js';

export const GIT_CONFIGURATION = 'git.jsonc';
export const GIT_CONFIGURATION_PATH = `.obsidian/webobsidian/${GIT_CONFIGURATION}`;

export async function readGitPreferencesSource() {
  const source = await readVaultConfiguration(GIT_CONFIGURATION);
  const parsed = GitPreferencesSchema.strict().safeParse(source.exists ? parseConfiguration(source.content) : {});
  if (!parsed.success) throw Object.assign(new Error('Git 配置格式无效'), { status: 400 });
  return { source, preferences: parsed.data };
}

export async function gitPreferences() {
  return (await readGitPreferencesSource()).preferences;
}

export async function saveGitPreferences(value: unknown): Promise<void> {
  const patch = GitPreferencesSchema.partial().strict().safeParse(value);
  if (!patch.success) throw Object.assign(new Error('Git 配置格式无效'), { status: 400 });
  const previous = await readGitPreferencesSource();
  const preferences = GitPreferencesSchema.parse({ ...previous.preferences, ...patch.data,
    ...(patch.data.token === '••••••••' ? { token: previous.preferences.token } : {}) });
  await writeVaultConfiguration({ ...previous.source, content: JSON.stringify(preferences, null, 2) + '\n' });
}

export function redactGitPreferences(preferences: Awaited<ReturnType<typeof gitPreferences>>) {
  return { ...preferences, token: preferences.token ? '••••••••' : '' };
}
