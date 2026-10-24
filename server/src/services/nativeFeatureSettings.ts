import { vaultPathKey } from './vaultFile.js';
import { vaultConfigurationIdentity } from './vaultConfiguration.js';
import { getSettings, updateSettings } from './settings.js';
import { readLegacyTagPreferences } from './tags/migration.js';
import { normalizeFolderTags } from '@webobsidian/markdown-core';
import type { TagPreferences } from '@webobsidian/markdown-core';

export async function nativeFeatureSettings() {
  const settings = await getSettings(), identity = await vaultConfigurationIdentity(), key = vaultPathKey(settings.vault.path);
  if (identity.key !== key) throw Object.assign(new Error('Vault changed; reopen settings'), { status: 409 });
  let value = settings.nativeFeatures[key];
  if (!value) {
    const tags = await readLegacyTagPreferences();
    const updated = await updateSettings(draft => {
      if (vaultPathKey(draft.vault.path) !== key) throw Object.assign(new Error('Vault changed during feature settings import'), { status: 409 });
      draft.nativeFeatures[key] ??= { tags: { ...tags, folderTags: tags.folderTags ?? { enabled: false, pruneAncestors: true, rules: [] } }, attachments: { excludeDirectories: [], excludeExtensions: [] } };
    });
    value = updated.nativeFeatures[key];
  }
  const { automation: _legacyAutomation, ...preferences } = value;
  return { vault: identity.vault, ...preferences };
}

export async function patchNativeFeatureSettings(input: {
  vault: string; tags?: Partial<TagPreferences>;
  attachments?: { excludeDirectories: string[]; excludeExtensions: string[] };
}) {
  const current = await nativeFeatureSettings();
  if (current.vault !== input.vault) throw Object.assign(new Error('Vault changed; reopen settings'), { status: 409 });
  const identity = await vaultConfigurationIdentity();
  if (identity.vault !== input.vault) throw Object.assign(new Error('Vault changed; reopen settings'), { status: 409 });
  await updateSettings(draft => {
    const key = vaultPathKey(draft.vault.path);
    if (key !== identity.key) throw Object.assign(new Error('Vault changed; reopen settings'), { status: 409 });
    const target = draft.nativeFeatures[key];
    if (!target) throw new Error('Native settings are not initialized');
    if (input.tags) Object.assign(target.tags, input.tags, input.tags.folderTags ? { folderTags: normalizeFolderTags(input.tags.folderTags) } : {});
    if (input.attachments) target.attachments = input.attachments;
  });
  return nativeFeatureSettings();
}
