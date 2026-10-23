import { findNodeAtLocation, parseTree, printParseErrorCode, type Node, type ParseError } from 'jsonc-parser';
import type { CompiledAddition, CompiledMenuConfig, MenuAddition, MenuCondition, MenuConfig, MenuContext, MenuDiagnostic } from './types';

export const MENU_CONFIG_ROOT = 'menu.jsonc';
export const MENU_CONFIG_DIRECTORY = '.obsidian/webobsidian/menus/';
export const MENU_CONFIG_MAX_FILES = 32;
export const MENU_CONFIG_MAX_BYTES = 1024 * 1024;
type KeyPath = (string | number)[];

/** Includes are relative to their importing file and cannot escape the menu directory. */
export function resolveMenuInclude(from: string, input: string): string {
  if (!input || /[\\\x00-\x1f:?#%]/.test(input) || input.startsWith('/')) throw new Error('请使用以正斜杠分隔的相对 .jsonc 路径');
  const parts = from.split('/').slice(0, -1);
  for (const part of input.split('/')) {
    if (part === '.' || part === '') continue;
    if (part === '..') {
      if (!parts.length) throw new Error('include 路径超出菜单配置目录');
      parts.pop();
    } else {
      if (!/^[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/.test(part) || part.endsWith('.') || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part)) throw new Error('菜单配置文件名无效');
      parts.push(part);
    }
  }
  const result = parts.join('/');
  if (!/\.jsonc$/i.test(result) || result.length > 240) throw new Error('菜单配置文件必须使用 .jsonc');
  return result;
}

export function menuDiagnostic(file: string, content: string, message: string, offset = 0, length = 1): MenuDiagnostic {
  const preceding = content.slice(0, offset);
  const lines = preceding.split(/\r\n|\r|\n/);
  return { file, line: lines.length, column: lines.at(-1)!.length + 1, offset, length, message };
}

/** Strict schema validation keeps typos/unsupported executable fields from silently succeeding. */
export function parseMenuConfig(file: string, content: string): { config?: MenuConfig; diagnostics: MenuDiagnostic[] } {
  try { return parseMenuConfigUnchecked(file, content); }
  catch (error) { return { diagnostics: [menuDiagnostic(file, content, `Cannot parse menu configuration: ${String((error as Error).message ?? error)}`)] }; }
}

function parseMenuConfigUnchecked(file: string, content: string): { config?: MenuConfig; diagnostics: MenuDiagnostic[] } {
  const diagnostics: MenuDiagnostic[] = [];
  const errors: ParseError[] = [];
  const tree = parseTree(content.replace(/^\uFEFF/, ' '), errors, { allowTrailingComma: true, disallowComments: false });
  for (const error of errors) diagnostics.push(menuDiagnostic(file, content, printParseErrorCode(error.error), error.offset, error.length));
  if (errors.length || !tree) return { diagnostics: diagnostics.length ? diagnostics : [menuDiagnostic(file, content, '需要 version 为 1 的菜单配置')] };
  const fail = (at: KeyPath, message: string) => {
    const node = findNodeAtLocation(tree, at) ?? tree;
    diagnostics.push(menuDiagnostic(file, content, message, node.offset, node.length));
  };
  const object = (value: unknown, at: KeyPath, keys: string[]): value is Record<string, any> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) { fail(at, '应为对象'); return false; }
    for (const key of Object.keys(value)) if (!keys.includes(key)) fail([...at, key], `Unknown field: ${key}`);
    return true;
  };
  const text = (value: unknown, at: KeyPath, empty = false) => {
    if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > 2000) fail(at, '应为非空字符串（最多 2000 字符）');
  };
  const texts = (value: unknown, at: KeyPath) => {
    if (!Array.isArray(value) || !value.length || value.length > 128) { fail(at, '应为 1–128 个字符串的数组'); return; }
    value.forEach((v, i) => text(v, [...at, i]));
  };
  const bool = (v: unknown, at: KeyPath) => { if (typeof v !== 'boolean') fail(at, '应为布尔值'); };
  const number = (v: unknown, at: KeyPath, integer = false) => { if (typeof v !== 'number' || !Number.isFinite(v) || (integer && (!Number.isInteger(v) || v < 0))) fail(at, integer ? '应为非负整数' : '应为有限数字'); };
  const condition = (v: unknown, at: KeyPath, depth = 0) => {
    if (depth > 12) { fail(at, '条件最多嵌套 12 层'); return; }
    if (!object(v, at, ['contexts', 'sources', 'selection', 'files', 'fileTypes', 'fileMatch', 'paths', 'link', 'tag', 'modifiers', 'all', 'any', 'not'])) return;
    for (const key of ['contexts', 'sources', 'fileTypes', 'paths']) if (v[key] !== undefined) texts(v[key], [...at, key]);
    if (v.selection !== undefined && !['none', 'text'].includes(v.selection)) fail([...at, 'selection'], '只能为 none 或 text');
    if (v.fileMatch !== undefined && !['all', 'any'].includes(v.fileMatch)) fail([...at, 'fileMatch'], '只能为 all 或 any');
    for (const key of ['link', 'tag']) if (v[key] !== undefined) bool(v[key], [...at, key]);
    if (v.files !== undefined && object(v.files, [...at, 'files'], ['min', 'max'])) {
      for (const key of ['min', 'max']) if (v.files[key] !== undefined) number(v.files[key], [...at, 'files', key], true);
      if (v.files.min > v.files.max) fail([...at, 'files'], 'min 不能大于 max');
    }
    if (v.modifiers !== undefined && object(v.modifiers, [...at, 'modifiers'], ['shift', 'ctrl', 'alt', 'meta'])) for (const key of Object.keys(v.modifiers)) bool(v.modifiers[key], [...at, 'modifiers', key]);
    for (const key of ['all', 'any']) if (v[key] !== undefined) {
      if (!Array.isArray(v[key]) || !v[key].length || v[key].length > 128) fail([...at, key], '应为 1–128 个条件');
      else v[key].forEach((c: unknown, i: number) => condition(c, [...at, key, i], depth + 1));
    }
    if (v.not !== undefined) condition(v.not, [...at, 'not'], depth + 1);
  };
  const common = (v: Record<string, any>, at: KeyPath) => {
    if (v.when !== undefined) condition(v.when, [...at, 'when']);
    for (const key of ['title', 'icon', 'group']) if (v[key] !== undefined) text(v[key], [...at, key], key === 'icon');
    if (v.order !== undefined) number(v.order, [...at, 'order']);
  };
  const addition = (v: unknown, at: KeyPath, depth = 0) => {
    if (depth > 12) { fail(at, '子菜单最多嵌套 12 层'); return; }
    if (!object(v, at, ['id', 'title', 'icon', 'command', 'separator', 'submenu', 'when', 'order', 'group'])) return;
    text(v.id, [...at, 'id']);
    common(v, at);
    if (v.separator !== undefined) bool(v.separator, [...at, 'separator']);
    if (v.separator === true) {
      if (v.command !== undefined || v.submenu !== undefined) fail(at, '分隔符不能带命令或子菜单');
    } else {
      text(v.title, [...at, 'title']);
      if ((v.command === undefined) === (v.submenu === undefined)) fail(at, '必须且只能提供 command 或 submenu 之一');
      if (v.command !== undefined) text(v.command, [...at, 'command']);
      if (v.submenu !== undefined) array(v.submenu, [...at, 'submenu'], (x, p) => addition(x, p, depth + 1));
    }
  };
  const array = (v: unknown, at: KeyPath, each: (x: unknown, p: KeyPath) => void) => {
    if (!Array.isArray(v) || v.length > 1024) { fail(at, '应为数组（最多 1024 项）'); return; }
    v.forEach((x, i) => each(x, [...at, i]));
  };
  const valueOf = (node: Node): any => node.type === 'object'
    ? Object.fromEntries((node.children ?? []).map((p) => [p.children![0].value, valueOf(p.children![1])]))
    : node.type === 'array' ? (node.children ?? []).map(valueOf) : node.value;
  const value = valueOf(tree);
  if (!object(value, [], ['version', 'includes', 'imports', 'rules', 'items'])) return { diagnostics };
  if (value.version !== 1) fail(['version'], 'version 必须为 1');
  for (const key of ['includes', 'imports']) if (value[key] !== undefined) {
    array(value[key], [key], (v, at) => {
      text(v, at);
      if (typeof v === 'string') try { resolveMenuInclude(file, v); } catch (e) { fail(at, String((e as Error).message)); }
    });
  }
  if (value.items !== undefined) array(value.items, ['items'], addition);
  if (value.rules !== undefined) array(value.rules, ['rules'], (v, at) => {
    if (!object(v, at, ['match', 'when', 'hide', 'title', 'icon', 'order', 'group', 'move'])) return;
    common(v, at);
    if (v.hide !== undefined) bool(v.hide, [...at, 'hide']);
    if (object(v.match, [...at, 'match'], ['id', 'weak'])) {
      if ((v.match.id === undefined) === (v.match.weak === undefined)) fail([...at, 'match'], '必须提供 id 或显式 weak 匹配之一');
      if (v.match.id !== undefined) Array.isArray(v.match.id) ? texts(v.match.id, [...at, 'match', 'id']) : text(v.match.id, [...at, 'match', 'id']);
      if (v.match.weak !== undefined && object(v.match.weak, [...at, 'match', 'weak'], ['title', 'icon', 'section'])) {
        text(v.match.weak.title, [...at, 'match', 'weak', 'title']);
        for (const key of ['icon', 'section']) if (v.match.weak[key] !== undefined) text(v.match.weak[key], [...at, 'match', 'weak', key], true);
      }
    }
    if (v.move !== undefined && object(v.move, [...at, 'move'], ['parent', 'before', 'after', 'index'])) {
      if (v.move.parent !== null) text(v.move.parent, [...at, 'move', 'parent']);
      for (const key of ['before', 'after']) if (v.move[key] !== undefined) text(v.move[key], [...at, 'move', key]);
      if (v.move.index !== undefined) number(v.move.index, [...at, 'move', 'index'], true);
      if (['before', 'after', 'index'].filter((k) => v.move[k] !== undefined).length > 1) fail([...at, 'move'], 'Use only one of before, after or index');
    }
  });
  // Reject duplicate JSON object keys rather than relying on last-value-wins parsing.
  const duplicates = (node: Node) => {
    if (node.type === 'object') {
      const seen = new Set<string>();
      for (const p of node.children ?? []) {
        const key = p.children![0];
        if (seen.has(key.value)) diagnostics.push(menuDiagnostic(file, content, `Duplicate field: ${key.value}`, key.offset, key.length));
        seen.add(key.value);
      }
    }
    node.children?.forEach(duplicates);
  };
  duplicates(tree);
  return { config: diagnostics.length ? undefined : value as MenuConfig, diagnostics };
}

function glob(pattern: string) {
  let expression = '^';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      i++;
      if (pattern[i + 1] === '/') { i++; expression += '(?:.*/)?'; }
      else expression += '.*';
    } else if (c === '*') expression += '[^/]*';
    else if (c === '?') expression += '[^/]';
    else expression += c.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  }
  return new RegExp(expression + '$', 'i');
}

export function compileMenuCondition(condition?: MenuCondition): (context: MenuContext) => boolean {
  if (!condition) return () => true;
  const all = condition.all?.map(compileMenuCondition);
  const any = condition.any?.map(compileMenuCondition);
  const not = condition.not && compileMenuCondition(condition.not);
  const paths = condition.paths?.map(glob);
  const types = condition.fileTypes?.map((s) => s.replace(/^\./, '').toLowerCase());
  return (c) => {
    if (condition.contexts && !condition.contexts.includes(c.kind)) return false;
    if (condition.sources && (!c.source || !condition.sources.includes(c.source))) return false;
    if (condition.selection && (condition.selection === 'text') !== Boolean(c.selection?.text.length)) return false;
    const count = c.paths?.length ?? 0;
    if (condition.files && (count < (condition.files.min ?? 0) || count > (condition.files.max ?? Infinity))) return false;
    if (condition.link !== undefined && condition.link !== Boolean(c.link)) return false;
    if (condition.tag !== undefined && condition.tag !== Boolean(c.tag)) return false;
    if (condition.modifiers && Object.entries(condition.modifiers).some(([k, v]) => Boolean(c.modifiers?.[k as keyof typeof c.modifiers]) !== v)) return false;
    if (types) {
      const selected = c.fileTypes ?? (c.kind === 'folder' ? [] : c.paths?.map((p) => /\.([^./]+)$/.exec(p)?.[1] ?? '') ?? []);
      const matches = (ext: string) => types.includes(ext.replace(/^\./, '').toLowerCase());
      if (!selected.length || !(condition.fileMatch === 'any' ? selected.some(matches) : selected.every(matches))) return false;
    }
    if (paths && (!count || !c.paths!.every((p) => paths.some((re) => re.test(p))))) return false;
    return (!all || all.every((f) => f(c))) && (!any || any.some((f) => f(c))) && (!not || !not(c));
  };
}

export function compileMenuConfig(configs: readonly MenuConfig[]): CompiledMenuConfig {
  const compileAddition = (item: MenuAddition): CompiledAddition => ({ item, test: compileMenuCondition(item.when), submenu: item.submenu?.map(compileAddition) });
  return {
    rules: configs.flatMap((c) => c.rules ?? []).map((rule) => ({ rule, test: compileMenuCondition(rule.when) })),
    items: configs.flatMap((c) => c.items ?? []).map(compileAddition),
  };
}
