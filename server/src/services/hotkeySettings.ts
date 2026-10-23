import path from 'node:path';
import { bindingFromString, emptyHotkeys, hotkeyCommandId, hotkeySignature, normalizeHotkeyMap, type HotkeyPreferences, type VaultHotkeys } from '@webobsidian/search-core';
import { getSettings, updateSettings } from './settings.js';
import { parseConfiguration, readObsidianConfiguration, vaultConfigurationIdentity } from './vaultConfiguration.js';

const fail = (message: string, status = 400) => Object.assign(new Error(message), { status });
const rootKey = (root: string) => path.resolve(root);
const migrating = new Map<string, Promise<VaultHotkeys>>();

/** Import all bindings once. Original Obsidian files are strictly read-only. */
export async function readHotkeys(): Promise<VaultHotkeys> {
  const settings = await getSettings(), root = rootKey(settings.vault.path);
  const source = await vaultConfigurationIdentity();
  if (rootKey(source.root) !== root) throw fail('Vault 已切换，请重新打开快捷键设置', 409);
  const current = settings.hotkeys[root];
  if (current) return { ...current, vault: source.vault };
  let operation = migrating.get(root);
  if (!operation) {
    operation = migrate(root, source.vault).finally(() => migrating.delete(root));
    migrating.set(root, operation);
  }
  return operation;
}
async function migrate(root: string, vault: string): Promise<VaultHotkeys> {
  const source = await readObsidianConfiguration('hotkeys.json');
  if (source.vault !== vault) throw fail('Vault 已切换，请重新打开快捷键设置', 409);
  const next: HotkeyPreferences = emptyHotkeys();
  if (source.exists) next.bindings = normalizeHotkeyMap(parseConfiguration(source.content));
  next.imported = Object.keys(next.bindings);
  const settings = await getSettings();
  // Earlier versions stored only the first Fuzzy binding. Preserve a deliberate
  // changed/disabled value, but recover all original alternatives when it matches.
  for (const [old, value] of Object.entries(settings.search.chinese.shortcuts)) {
    const id = hotkeyCommandId(old), binding = value ? bindingFromString(value) : null;
    if (value && !binding) continue;
    if (binding && next.bindings[id]?.some(key => hotkeySignature(key) === hotkeySignature(binding))) continue;
    next.bindings[id] = binding ? [binding] : [];
  }
  for (const [old, keys] of Object.entries(settings.writing[root]?.hotkeys ?? {})) {
    const id = hotkeyCommandId(old);
    if (!Object.hasOwn(next.bindings, id)) Object.assign(next.bindings, normalizeHotkeyMap({ [old]: keys }));
  }
  next.migration = source.exists ? '已只读导入 .obsidian/hotkeys.json；原始文件保留' : '使用默认快捷键；未发现 Obsidian 快捷键文件';
  const saved = await updateSettings(draft => {
    if (rootKey(draft.vault.path) !== root) throw fail('Vault 已切换，请重新打开快捷键设置', 409);
    draft.hotkeys[root] ??= next;
  });
  return { ...saved.hotkeys[root], vault };
}
export async function patchHotkeys(input: unknown): Promise<VaultHotkeys> {
  if (!input || typeof input !== 'object') throw fail('快捷键请求无效');
  const { vault, command, bindings } = input as Record<string, unknown>;
  if (typeof vault !== 'string' || typeof command !== 'string' || !command || command.length > 512 || (bindings !== null && !Array.isArray(bindings))) throw fail('快捷键请求无效');
  const current = await readHotkeys();
  if (current.vault !== vault) throw fail('Vault 已切换，请重新打开快捷键设置', 409);
  const identity = await vaultConfigurationIdentity();
  if (identity.vault !== vault) throw fail('Vault 已切换，请重新打开快捷键设置', 409);
  const root = rootKey(identity.root), id = hotkeyCommandId(command);
  const normalized = bindings === null ? null : normalizeHotkeyMap({ [id]: bindings })[id];
  const saved = await updateSettings(draft => {
    if (rootKey(draft.vault.path) !== root) throw fail('Vault 已切换，请重新打开快捷键设置', 409);
    const preferences = draft.hotkeys[root];
    if (!preferences) throw fail('快捷键尚未载入，请重试', 409);
    if (normalized === null) delete preferences.bindings[id];
    else preferences.bindings[id] = normalized;
  });
  return { ...saved.hotkeys[root], vault };
}
