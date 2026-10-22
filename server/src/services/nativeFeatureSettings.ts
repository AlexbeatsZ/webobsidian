import path from 'node:path';
import { createHash } from 'node:crypto';
import { getSettings, updateSettings } from './settings.js';
import { readLegacyTagPreferences } from './tags/migration.js';
import { normalizeFolderTags } from './tags/folderRules.js';
import type { TagPreferences } from './tags/types.js';

function vaultKey(value: string) {
  const root = path.resolve(value);
  return process.platform === 'win32' ? root.toLowerCase() : root;
}
const vaultToken = (key: string) => createHash('sha256').update(key).digest('base64url');
export async function nativeFeatureSettings() {
  const settings = await getSettings(), key = vaultKey(settings.vault.path);
  let value = settings.nativeFeatures[key];
  if (!value) {
    const tags = await readLegacyTagPreferences();
    const updated = await updateSettings(draft => {
      if (vaultKey(draft.vault.path) !== key) throw Object.assign(new Error('Vault changed during feature settings import'), { status: 409 });
      draft.nativeFeatures[key] ??= { tags: { ...tags, folderTags: tags.folderTags ?? { enabled: false, pruneAncestors: true, rules: [] } }, attachments: { excludeDirectories: [], excludeExtensions: [] } };
    });
    value = updated.nativeFeatures[key];
  }
  const { automation: _legacyAutomation, ...preferences } = value;
  return { vault: vaultToken(key), ...preferences };
}

export async function patchNativeFeatureSettings(input: {
  vault: string; tags?: Partial<TagPreferences>;
  attachments?: { excludeDirectories: string[]; excludeExtensions: string[] };
}) {
  const current = await nativeFeatureSettings();
  if (current.vault !== input.vault) throw Object.assign(new Error('Vault changed; reopen settings'), { status: 409 });
  await updateSettings(draft => {
    const key = vaultKey(draft.vault.path);
    if (vaultToken(key) !== input.vault) throw Object.assign(new Error('Vault changed; reopen settings'), { status: 409 });
    const target = draft.nativeFeatures[key];
    if (!target) throw new Error('Native settings are not initialized');
    if (input.tags) Object.assign(target.tags, input.tags, input.tags.folderTags ? { folderTags: normalizeFolderTags(input.tags.folderTags) } : {});
    if (input.attachments) target.attachments = input.attachments;
  });
  return nativeFeatureSettings();
}
