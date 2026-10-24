import { planTagSource, type TagSourcePlan } from './source.js';
import { tagKey, tagName, validTag } from '@webobsidian/search-core';
import type { FolderTagSettings, FolderTagRule } from './types.js';
import type { MarkdownModel } from '../syntax.js';

export const emptyFolderTags = (): FolderTagSettings => ({ enabled: false, pruneAncestors: true, rules: [] });
const invalid = (message: string): never => { throw Object.assign(new Error(message), { status: 400 }); };
export function normalizeFolderTags(input: FolderTagSettings): FolderTagSettings {
  if (!input || typeof input.enabled !== 'boolean' || typeof input.pruneAncestors !== 'boolean' || !Array.isArray(input.rules) || input.rules.length > 256)
    invalid('Invalid folder tag settings');
  const rules = input.rules.map((rule): FolderTagRule => {
    if (!rule || typeof rule.folder !== 'string') invalid('文件夹必须是字符串');
    const folder = rule.folder.trim().replace(/\\/g, '/').replace(/\/+$/, '');
    if (typeof folder !== 'string' || folder.startsWith('/') || /[:\0]/.test(folder) ||
      (folder && folder.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.'))) || typeof rule.recursive !== 'boolean')
      invalid('文件夹必须是 Vault 内的可见相对路径；根目录用空字符串');
    if (!Array.isArray(rule.tags) || !rule.tags.length || rule.tags.length > 128 || rule.tags.some(tag => typeof tag !== 'string' || !validTag(tag)))
      invalid('每条文件夹规则需要 1–128 个有效标签');
    const seen = new Set<string>();
    const tags = rule.tags.map(tagName).filter(tag => { const key = tagKey(tag); if (seen.has(key)) return false; seen.add(key); return true; });
    return { folder, tags, recursive: rule.recursive };
  });
  return { enabled: input.enabled, pruneAncestors: input.pruneAncestors, rules };
}
export function folderRuleTags(path: string, settings?: FolderTagSettings): string[] {
  if (!settings || !/\.(md|markdown)$/i.test(path) || path.split('/').some(part => part.startsWith('.'))) return [];
  const parent = path.split('/').slice(0, -1).join('/').normalize('NFC').toLowerCase();
  const tags = new Map<string, string>();
  for (const rule of settings.rules) {
    const folder = rule.folder.normalize('NFC').toLowerCase();
    if (parent === folder || (rule.recursive && (!folder || parent.startsWith(folder + '/'))))
      for (const tag of rule.tags) if (!tags.has(tagKey(tag))) tags.set(tagKey(tag), tag);
  }
  return [...tags.values()];
}
export function planFolderTags(raw: string, path: string, settings?: FolderTagSettings, model?: MarkdownModel): TagSourcePlan {
  const tags = folderRuleTags(path, settings);
  return tags.length ? planTagSource(raw, { kind: 'add', tags, pruneAncestors: settings?.pruneAncestors }, model) : { raw, changes: [], expected: [] };
}
