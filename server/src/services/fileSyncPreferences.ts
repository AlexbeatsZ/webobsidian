import { FileSyncPreferencesSchema } from '../contracts/fileSync.js';
import { parseConfiguration, readVaultConfiguration } from './vaultConfiguration.js';
import { normalizeSyncEndpoint } from './syncTransport.js';

export const FILE_SYNC_CONFIGURATION = 'sync.jsonc';
export const FILE_SYNC_CONFIGURATION_PATH = `.obsidian/webobsidian/${FILE_SYNC_CONFIGURATION}`;

export function parseFileSyncPreferences(value: unknown) {
  const parsed = FileSyncPreferencesSchema.strict().safeParse(value);
  if (!parsed.success) throw Object.assign(new Error('同步设置格式无效'), { status: 400 });
  const preferences = parsed.data;
  try { preferences.endpoints = preferences.endpoints.map(normalizeSyncEndpoint); }
  catch (error) { throw Object.assign(error as Error, { status: 400 }); }
  if (preferences.enabled && !preferences.endpoints.length) throw Object.assign(new Error('请填写同步地址'), { status: 400 });
  if (preferences.enabled && !/^[\x21-\x7e]{32,512}$/.test(preferences.token)) throw Object.assign(new Error('访问令牌需要 32–512 个 ASCII 字符'), { status: 400 });
  return preferences;
}

export async function readFileSyncPreferencesSource() {
  const source = await readVaultConfiguration(FILE_SYNC_CONFIGURATION);
  const preferences = parseFileSyncPreferences(source.exists ? parseConfiguration(source.content) : {});
  return { source, preferences };
}

export async function fileSyncPreferences() {
  return (await readFileSyncPreferencesSource()).preferences;
}
