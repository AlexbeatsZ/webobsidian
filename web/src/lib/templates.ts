import type { App } from './obsidian/runtime';
import type { CommandContext } from './commands';
import { commandContext } from './commands';
import { normalizePath, type TFile } from './obsidian/vault';
import { insertWritingTemplate } from './writing/editing';

export interface TemplateOutput { text: string; cursors: { order: number; from: number; to: number }[] }
export interface TemplateEnvironment {
  values: Record<string, unknown>;
  execute(id: string, args: unknown): Promise<unknown>;
  read(path: string): Promise<string>;
  assertCurrent(): void;
}
type Expression = { kind: 'value'; path: string } | { kind: 'property'; path: string } |
  { kind: 'call'; id: string; args: unknown };
type Directive = { kind: 'text'; text: string } | { kind: 'include'; path: string } |
  { kind: 'cursor'; order: number } | { kind: 'expression'; expression: Expression; name?: string; discard: boolean };
type Token = { directive: Directive; line: number };
const compiled = new Map<string, { source: string; tokens: Token[] }>();
const forbidden = new Set(['__proto__', 'constructor', 'prototype']);

function ownValue(values: unknown, path: string): unknown {
  for (const key of path.split('.')) {
    if (forbidden.has(key) || values === null || typeof values !== 'object' || !Object.hasOwn(values, key))
      throw new Error(`变量不存在：${path}`);
    values = (values as Record<string, unknown>)[key];
  }
  return values;
}
function quoted(source: string): [string, string] {
  if (!source.startsWith('"')) throw new Error('参数必须是 JSON 双引号字符串');
  let escaped = false;
  for (let i = 1; i < source.length; i++) {
    if (source[i] === '"' && !escaped) return [JSON.parse(source.slice(0, i + 1)), source.slice(i + 1).trim()];
    escaped = source[i] === '\\' && !escaped;
  }
  throw new Error('字符串未结束');
}
function expression(source: string): Expression {
  if (/^(title|path|folder|selection|[a-zA-Z_][\w]*(?:\.[\w]+)*)$/.test(source)) return { kind: 'value', path: source };
  const value = source.match(/^(command|date|property)\s+([\s\S]+)$/);
  if (!value) throw new Error('仅支持变量、date、property 和 command；复杂逻辑请注册 JS 指令');
  const [argument, rest] = quoted(value[2]);
  if (value[1] === 'property') {
    if (rest) throw new Error('property 只接受一个属性名');
    return { kind: 'property', path: argument };
  }
  if (value[1] === 'date') {
    if (rest) throw new Error('date 只接受一个格式字符串');
    return { kind: 'call', id: 'date:now', args: { format: argument } };
  }
  return { kind: 'call', id: argument, args: rest ? JSON.parse(rest) : {} };
}
function directive(source: string): Directive {
  const legacy: Record<string, string> = { 'tp.file.title': 'title', 'tp.file.path()': 'path',
    'tp.file.folder()': 'folder', 'tp.file.selection()': 'selection' };
  source = legacy[source] ?? source;
  source = source.replace(/^tp\.date\.now\(("(?:[^"\\]|\\.)*")?\)$/, (_, format) => 'date ' + (format ?? '"YYYY-MM-DD"'))
    .replace(/^tp\.file\.cursor\((\d*)\)$/, (_, order) => 'cursor ' + (order || '1'))
    .replace(/^tp\.frontmatter\.([\w]+)$/, 'property "$1"');
  if (source.startsWith('include ')) {
    const [path, rest] = quoted(source.slice(8).trim());
    if (rest) throw new Error('include 只接受一个 Vault 相对路径');
    return { kind: 'include', path };
  }
  if (/^cursor(?:\s+\d+)?$/.test(source)) {
    const order = Number(source.split(/\s+/)[1] ?? 1);
    if (!Number.isSafeInteger(order) || order > 10000) throw new Error('光标序号必须是 0–10000 的整数');
    return { kind: 'cursor', order };
  }
  const assignment = source.match(/^let\s+([a-zA-Z_]\w*)\s*=\s*([\s\S]+)$/);
  if (assignment && (forbidden.has(assignment[1]) || ['title', 'path', 'folder', 'selection', 'properties'].includes(assignment[1])))
    throw new Error('不能覆盖内置变量');
  const discard = source.startsWith('do ');
  const input = assignment?.[2] ?? (discard ? 'command ' + source.slice(3) : source);
  return { kind: 'expression', expression: expression(input), name: assignment?.[1], discard };
}

/** Bounded source cache; no compilation in editor input/rendering paths. */
function compile(source: string, path: string): Token[] {
  const prior = compiled.get(path);
  if (prior?.source === source) return prior.tokens;
  const tokens: Token[] = [];
  let start = 0, line = 1;
  const pushText = (text: string) => { if (text) tokens.push({ directive: { kind: 'text', text }, line }); line += (text.match(/\n/g) ?? []).length; };
  while (start < source.length) {
    const opening = source.indexOf('<%', start);
    if (opening < 0) { pushText(source.slice(start)); break; }
    pushText(source.slice(start, opening));
    if (source[opening + 2] === '%') { pushText('<%'); start = opening + 3; continue; }
    let end = opening + 2, inString = false, escaped = false;
    for (; end < source.length; end++) {
      const c = source[end];
      if (!inString && c === '%' && source[end + 1] === '>') break;
      if (c === '"' && !escaped) inString = !inString;
      escaped = inString && c === '\\' && !escaped;
    }
    try {
      if (end === source.length) throw new Error('指令缺少 %>');
      tokens.push({ directive: directive(source.slice(opening + 2, end).trim()), line });
    } catch (error) { throw new Error(`${path}:${line}：${error instanceof Error ? error.message : String(error)}`); }
    line += (source.slice(opening, end + 2).match(/\n/g) ?? []).length;
    start = end + 2;
  }
  if (compiled.size >= 64) compiled.delete(compiled.keys().next().value!);
  compiled.set(path, { source, tokens });
  return tokens;
}
function argumentsWithValues(value: unknown, variables: Record<string, unknown>): unknown {
  if (Array.isArray(value)) return value.map(item => argumentsWithValues(item, variables));
  if (!value || typeof value !== 'object') return value;
  const object = value as Record<string, unknown>;
  if (Object.keys(object).length === 1 && typeof object.$var === 'string') return ownValue(variables, object.$var);
  return Object.fromEntries(Object.entries(object).map(([key, item]) => [key, argumentsWithValues(item, variables)]));
}
function asText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') return String(value);
  throw new Error('插入结果必须是文本或数值；操作指令请使用 do，对象请先提取字段');
}

export async function renderTemplate(source: string, path: string, environment: TemplateEnvironment,
  stack: readonly string[] = []): Promise<TemplateOutput> {
  if (stack.length >= 16 || stack.includes(path)) throw new Error(`子模板循环或超过 16 层：${[...stack, path].join(' → ')}`);
  if (source.length > 1024 * 1024) throw new Error(`${path}：模板超过 1 MiB`);
  source = source.replace(/^\uFEFF/, '').replace(/\r\n|\r/g, '\n');
  const output: TemplateOutput = { text: '', cursors: [] };
  const parts: string[] = []; let length = 0;
  const append = (text: string) => { text = text.replace(/\r\n|\r/g, '\n'); length += text.length; if (length > 4 * 1024 * 1024) throw new Error('模板输出超过 4 MiB'); parts.push(text); };
  for (const token of compile(source, path)) {
    try {
      environment.assertCurrent();
      const item = token.directive;
      if (item.kind === 'text') append(item.text);
      else if (item.kind === 'cursor') output.cursors.push({ order: item.order, from: length, to: length });
      else if (item.kind === 'include') {
        const child = normalizePath(item.path);
        if (!child || child.split('/').includes('..') || !/\.(?:md|markdown)$/i.test(child)) throw new Error('子模板必须是 Vault 内 Markdown 文件');
        const included = await renderTemplate(await environment.read(child), child, environment, [...stack, path]);
        const offset = length; append(included.text);
        output.cursors.push(...included.cursors.map(cursor => ({ ...cursor, from: cursor.from + offset, to: cursor.to + offset })));
      } else {
        const expr = item.expression;
        const result = expr.kind === 'value' ? ownValue(environment.values, expr.path) :
          expr.kind === 'property' ? (Object.hasOwn(environment.values.properties as object, expr.path) ?
            (environment.values.properties as Record<string, unknown>)[expr.path] : undefined) :
          await environment.execute(expr.id, argumentsWithValues(expr.args, environment.values));
        if (item.name) environment.values[item.name] = result;
        else if (!item.discard) append(asText(result));
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      throw new Error(`${path}:${token.line}：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  environment.assertCurrent(); output.text = parts.join('');
  return output;
}

/** One Module for native palette and Obsidian template insertion. */
export class Templates {
  private running = new Set<AbortController>();
  constructor(private app: App) {}
  private async render(file: TFile, context: CommandContext): Promise<TemplateOutput> {
    const target = this.app.vault.getFileByPath(context.path);
    const values = Object.assign(Object.create(null), {
      title: target?.basename ?? context.path.split('/').pop()?.replace(/\.(md|markdown)$/i, '') ?? '',
      path: context.path, folder: context.path.split('/').slice(0, -1).join('/'), selection: context.selection,
      properties: target ? this.app.metadataCache.getFileCache(target)?.frontmatter ?? {} : {},
    });
    return renderTemplate(await this.app.vault.cachedRead(file), file.path, {
      values, assertCurrent: () => { context.signal?.throwIfAborted(); context.assertCurrent(); },
      execute: (id, args) => this.app.commands.execute(id, args, context),
      read: async path => {
        const child = this.app.vault.getFileByPath(path);
        if (!child) throw new Error(`子模板不存在：${path}`);
        return this.app.vault.cachedRead(child);
      },
    });
  }
  async insert(path: string, context = commandContext('template')) {
    const run = new AbortController(), abort = () => run.abort();
    context.signal?.throwIfAborted(); context.signal?.addEventListener('abort', abort, { once: true });
    this.running.add(run);
    try { await this.insertCaptured(path, { ...context, signal: run.signal }); }
    finally { context.signal?.removeEventListener('abort', abort); this.running.delete(run); }
  }
  private async insertCaptured(path: string, context: CommandContext) {
    context.assertCurrent();
    const view = context.view, file = this.app.vault.getFileByPath(path);
    if (!view || view.state.readOnly) throw new Error('请先打开可编辑的 Markdown 文档');
    if (!file) throw new Error(`模板不存在：${path}`);
    const result = await this.render(file, context);
    context.assertCurrent(); context.signal?.throwIfAborted();
    if (view.state.readOnly) throw new Error('文档已切换为只读，模板未插入');
    const selection = view.state.selection.main;
    insertWritingTemplate(view, selection.from, selection.to, result.text, result.cursors);
    view.focus();
  }
  async create(template: string, path: string, origin: CommandContext) {
    if (!path || path.startsWith('.') || path.split('/').some(part => part === '..' || !part) || !/\.(md|markdown)$/i.test(path))
      throw new Error('请填写 Vault 内的 Markdown 文件路径');
    const text = await this.newContent(template, path, origin);
    origin.assertCurrent();
    await this.app.vault.create(path, text, false);
    await this.app.workspace.openLinkText(path, '', false);
  }
  async newContent(template: string, path: string, origin = commandContext('template', path)): Promise<string> {
    const file = this.app.vault.getFileByPath(template);
    if (!file) throw new Error(`模板不存在：${template}`);
    const run = new AbortController(), abort = () => run.abort();
    origin.signal?.throwIfAborted(); origin.signal?.addEventListener('abort', abort, { once: true });
    this.running.add(run);
    try { return (await this.render(file, { ...origin, path, view: null, state: undefined, selection: '', signal: run.signal })).text; }
    finally { origin.signal?.removeEventListener('abort', abort); this.running.delete(run); }
  }
  cancel() { for (const run of this.running) run.abort(); this.running.clear(); compiled.clear(); }
}
