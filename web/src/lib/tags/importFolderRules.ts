import { parseTree, getNodeValue, type ParseError, type Node } from 'jsonc-parser';
import { normalizeFolderTags } from '@webobsidian/markdown-core';
import type { FolderTagSettings, FolderTagRule } from '@webobsidian/markdown-core';

/** Read the known data-only object literal without evaluating JavaScript. */
export function importLegacyFolderRules(note: string): FolderTagSettings {
  const match = note.match(/```(?:js|javascript)\s*\r?\n\s*\/\/\s*folder-tag-sync-config\s*\r?\n([\s\S]*?)\r?\n```/);
  if (!match) throw new Error('未找到 folder-tag-sync-config 代码块');
  let data = match[1].trim();
  if (data.startsWith('(') && data.endsWith(')')) data = data.slice(1, -1).trim();
  // Quoted strings and comments are copied untouched. Only the known unquoted
  // data keys are normalized to JSONC; calls, expressions and spread fail parse.
  data = data.replace(/("(?:\\.|[^"\\])*"|\/\/[^\r\n]*|\/\*[\s\S]*?\*\/)|\b(managedRoots|recursive|typeRules|subjectRules|folder|tags)\s*:/g,
    (whole, protectedToken: string | undefined, key: string | undefined) => protectedToken ?? JSON.stringify(key) + ':');
  const errors: ParseError[] = [];
  const tree = parseTree(data, errors, { allowTrailingComma: true });
  if (!tree || errors.length) throw new Error('旧配置只支持字符串、布尔值、数组和普通对象；不支持动态 JavaScript');
  const rejectDuplicates = (node: Node) => {
    if (node.type === 'object') {
      const keys = node.children?.map(property => String(property.children?.[0]?.value)) ?? [];
      if (new Set(keys).size !== keys.length) throw new Error('旧配置存在重复属性');
    }
    for (const child of node.children ?? []) rejectDuplicates(child);
  };
  rejectDuplicates(tree);
  const raw: unknown = getNodeValue(tree);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('旧配置必须是对象');
  const config = raw as Record<string, unknown>;
  if (Object.keys(config).some(key => !['managedRoots', 'recursive', 'typeRules', 'subjectRules'].includes(key)) ||
    !Array.isArray(config.managedRoots) || !config.managedRoots.length || config.managedRoots.some(root => typeof root !== 'string') ||
    (config.recursive !== undefined && typeof config.recursive !== 'boolean')) throw new Error('旧配置的管理目录或字段不受支持');
  const roots = (config.managedRoots as string[]).map(folder => normalizeFolderTags({ enabled: false, pruneAncestors: true,
    rules: [{ folder, tags: ['_validation'], recursive: false }] }).rules[0].folder);
  if (roots.some(root => !root)) throw new Error('旧配置的 managedRoots 不支持空目录');
  const rules: FolderTagRule[] = [];
  for (const key of ['typeRules', 'subjectRules']) {
    const entries = config[key] ?? [];
    if (!Array.isArray(entries)) throw new Error(key + ' 必须是数组');
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).some(key => !['folder', 'tags'].includes(key))) throw new Error('旧规则字段不受支持');
      const rule = normalizeFolderTags({ enabled: false, pruneAncestors: true, rules: [{ folder: entry.folder,
        tags: Array.isArray(entry.tags) ? entry.tags : typeof entry.tags === 'string' ? [entry.tags] : [], recursive: true }] }).rules[0];
      for (const root of roots) {
        // Clip rule coverage to the original managedRoots instead of enabling
        // inactive rules such as @管理 outside those roots.
        if (rule.folder === root || root.startsWith(rule.folder + '/')) rules.push({ ...rule, folder: root, recursive: config.recursive !== false });
        else if (config.recursive !== false && rule.folder.startsWith(root + '/')) rules.push(rule);
      }
    }
  }
  return normalizeFolderTags({ enabled: false, pruneAncestors: true,
    rules: [...new Map(rules.map(rule => [JSON.stringify(rule), rule])).values()] });
}
