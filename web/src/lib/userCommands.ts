import moment from 'moment';
import type { App } from './obsidian/runtime';
import { compileJavascript } from './javascript/execute';
import { promptInput, chooseInput } from './obsidian/ui';
import { type Command, type CommandContext } from './commands';
import { request } from './api';
import type { AutomationSettings } from '../../../server/src/contracts/automation';
import type { VaultConfigurationSource } from '../../../server/src/contracts';
export type { AutomationSettings };
export interface AutomationConfiguration { source: VaultConfigurationSource; settings: AutomationSettings }
export const readAutomation = () => request<AutomationConfiguration>('/api/native-features/automation');
export const importAutomation = (source: VaultConfigurationSource) => request<AutomationConfiguration>('/api/native-features/automation/import', { method: 'POST', body: JSON.stringify(source) });
import { useStore } from './store';
import { Templates } from './templates';
import { normalizePath } from './obsidian/vault';

const objectArgs = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('指令参数必须是对象');
  return value as Record<string, unknown>;
};
type Loaded = { source: string; command: Command; dispose(): void; abort: AbortController };

/** Vault-scoped definitions, compiled only at save/reload; no startup user JS. */
export class Automation {
  readonly templates: Templates;
  private loaded = new Map<string, Loaded>();
  private builtin: (() => void)[] = [];
  private lifetime = new AbortController();
  private loading?: Promise<void>;
  private stopped = false;
  private generation = 0;
  private settings?: AutomationSettings;
  constructor(private app: App) { this.templates = new Templates(app); }
  get templateFolder() { return this.settings?.templates.folder ?? ''; }
  private notify(error: unknown) {
    if (!(error instanceof DOMException && error.name === 'AbortError')) useStore.getState().notify(String(error));
  }
  load(): Promise<void> {
    if (useStore.getState().vaultSessionStale) return Promise.reject(new Error('Vault 已切换，请重新加载应用'));
    return this.loading ??= this.start();
  }
  private async start() {
    this.stopped = false;
    this.lifetime = new AbortController();
    this.installBuiltins();
    try { await this.reload(); } catch (error) { this.notify(error); }
    window.addEventListener('vault-changed', this.onVaultChanged);
  }
  private onVaultChanged = () => this.dispose();
  private installBuiltins() {
    if (this.builtin.length) return;
    const add = (command: Command) => {
      const run = command.run;
      if (run) command = { ...command, run: (args, context) => run(args, { ...context,
        signal: context.signal ? AbortSignal.any([context.signal, this.lifetime.signal]) : this.lifetime.signal }) };
      this.builtin.push(this.app.commands.register(command));
    };
    add({ id: 'date:now', name: '获取日期', run: (args, context) => {
      const { format = 'YYYY-MM-DD' } = objectArgs(args);
      if (typeof format !== 'string') throw new Error('日期格式必须是字符串');
      return moment(context.now).format(format);
    } });
    add({ id: 'input:prompt', name: '输入文本', run: (args, context) => {
      const { message = '请输入', initial = '' } = objectArgs(args);
      if (typeof message !== 'string' || typeof initial !== 'string') throw new Error('输入提示及默认值必须是字符串');
      return promptInput(this.app, message, initial, context.signal);
    } });
    add({ id: 'input:choose', name: '选择选项', run: (args, context) => {
      const { message = '请选择', items } = objectArgs(args);
      if (typeof message !== 'string' || !Array.isArray(items) || !items.length || items.length > 10000) throw new Error('请选择 1–10000 个选项');
      return chooseInput(this.app, message, items, item => typeof item === 'string' ? item : String(item?.label ?? item), context.signal);
    } });
    add({ id: 'clipboard:read', name: '读取剪贴板', run: () => navigator.clipboard.readText() });
    add({ id: 'automation:settings', name: '用户指令与模板设置', callback: () => {
      useStore.getState().setSettings(true); window.dispatchEvent(new Event('automation:open-settings'));
    } });
    add({ id: 'automation:reload', name: '重新加载用户指令与模板', callback: () => this.reload() });
    add({ id: 'templates:create', name: '从模板新建笔记', run: async (_args, context) => {
      const { searchEntries } = await import('./search');
      const folder = this.templateFolder;
      const files = searchEntries().filter(entry => folder && entry.path.startsWith(folder + '/') && /\.(md|markdown)$/i.test(entry.path));
      if (!files.length) throw new Error('请先设置模板目录并添加 Markdown 模板');
      const file = await chooseInput(this.app, '选择模板', files, file => file.path, context.signal);
      const path = normalizePath(await promptInput(this.app, '新笔记路径（包含 .md）', '', context.signal));
      context.assertCurrent();
      await this.templates.create(file.path, path, context);
    } });
  }
  private validate(settings: AutomationSettings) {
    if (!settings || !Array.isArray(settings.commands) || !settings.templates || !Array.isArray(settings.templates.bindings) || !Array.isArray(settings.templates.folderRules))
      throw new Error('配置需要 commands、templates.bindings 和 templates.folderRules 数组');
    const ids = new Set<string>();
    for (const item of [...settings.commands, ...settings.templates.bindings]) {
      if (ids.has(item.id)) throw new Error(`指令 ID 重复：${item.id}`); ids.add(item.id);
      if (this.app.commands.findCommand(item.id) && !this.loaded.has(item.id)) throw new Error(`指令 ID 已存在：${item.id}`);
    }
    for (const rule of settings.templates.folderRules) {
      if (normalizePath(rule.folder) !== rule.folder || rule.folder.split('/').includes('..') ||
          normalizePath(rule.template) !== rule.template || !/\.(?:md|markdown)$/i.test(rule.template))
        throw new Error('文件夹模板规则必须使用 Vault 相对路径和 Markdown 模板');
    }
    if (settings.templates.folderRules.length && this.app.plugins.enabledPlugins.has('templater-obsidian'))
      throw new Error('请先停用原 Templater，再启用原生新建文件模板规则，避免重复执行');
  }
  private prepare(settings: AutomationSettings): Map<string, { source: string; command: Command; abort: AbortController }> {
    this.validate(settings);
    const result = new Map<string, { source: string; command: Command; abort: AbortController }>();
    for (const definition of settings.commands) {
      if (!definition.enabled) continue;
      const source = JSON.stringify(definition);
      const existing = this.loaded.get(definition.id);
      if (existing?.source === source) { result.set(definition.id, existing); continue; }
      const execute = compileJavascript(definition.code,
        ['app', 'args', 'context', 'signal', 'onCleanup', 'prompt', 'choose', 'execute'], `webobsidian-command/${encodeURIComponent(definition.id)}`);
      const abort = new AbortController();
      const command: Command = { id: definition.id, name: definition.name, run: async (args, context) => {
        const controller = new AbortController(), cleanups: (() => void)[] = [];
        let disposed = false;
        const cleanup = () => {
          if (disposed) return; disposed = true; controller.abort();
          for (const fn of cleanups.splice(0).reverse()) { try { fn(); } catch (error) { console.error(error); } }
        };
        const register = (fn: () => void) => { if (typeof fn !== 'function') throw new Error('onCleanup 需要函数'); if (disposed) fn(); else cleanups.push(fn); };
        const parent = context.signal;
        parent?.throwIfAborted(); abort.signal.throwIfAborted();
        parent?.addEventListener('abort', cleanup, { once: true }); abort.signal.addEventListener('abort', cleanup, { once: true });
        const scoped = { ...context, signal: controller.signal,
          assertCurrent: () => { controller.signal.throwIfAborted(); context.assertCurrent(); } };
        try {
          const value = await execute(this.app, args, scoped, controller.signal, register,
            (message: string, initial = '') => promptInput(this.app, message, initial, controller.signal),
            <T>(message: string, items: T[], label?: (item: T) => string) => chooseInput(this.app, message, items, label, controller.signal),
            (id: string, input: unknown = {}) => this.app.commands.execute(id, input, scoped));
          controller.signal.throwIfAborted(); return value;
        } finally {
          parent?.removeEventListener('abort', cleanup); abort.signal.removeEventListener('abort', cleanup); cleanup();
        }
      } };
      result.set(command.id, { source, command, abort });
    }
    for (const binding of settings.templates.bindings) {
      const source = JSON.stringify(binding), existing = this.loaded.get(binding.id);
      const abort = new AbortController();
      result.set(binding.id, existing?.source === source ? existing : { source, abort,
        command: { id: binding.id, name: binding.name, run: (_args, context) => this.templates.insert(binding.path,
          { ...context, signal: context.signal ? AbortSignal.any([context.signal, abort.signal]) : abort.signal }) } });
    }
    return result;
  }
  private activate(settings: AutomationSettings, prepared: ReturnType<Automation['prepare']>) {
    for (const [id, previous] of this.loaded) if (prepared.get(id)?.source !== previous.source) {
      previous.abort.abort(); previous.dispose(); this.loaded.delete(id);
    }
    for (const [id, next] of prepared) if (!this.loaded.has(id)) {
      this.loaded.set(id, { ...next, dispose: this.app.commands.register(next.command) });
    }
    this.settings = settings;
    this.app.commands.changed();
  }
  async reload() {
    const generation = ++this.generation;
    const value = await readAutomation();
    if (generation !== this.generation || this.stopped) return;
    const prepared = this.prepare(value.settings);
    this.activate(value.settings, prepared);
  }
  async save(source: VaultConfigurationSource, settings: AutomationSettings) {
    const prepared = this.prepare(settings);
    const value = await request<AutomationConfiguration>('/api/native-features/automation', {
      method: 'PUT', body: JSON.stringify({ source, settings }),
    });
    if (this.stopped || source.vault !== value.source.vault) throw new Error('配置会话已变化，请重新打开设置');
    // The save broadcasts to this client too; invalidate its older pending reload.
    this.generation++;
    this.activate(value.settings, prepared);
    return value;
  }
  /** Run once at the initiating client's create seam, before fixed-tag persistence. */
  async prepareNewNote(path: string, body: string): Promise<string> {
    if (body || !/\.(md|markdown)$/i.test(path)) return body;
    await this.load();
    if (this.stopped || this.app.plugins.enabledPlugins.has('templater-obsidian')) return body;
    const folder = path.split('/').slice(0, -1).join('/');
    const rule = this.settings?.templates.folderRules.filter(r => !r.folder || folder === r.folder || folder.startsWith(r.folder + '/'))
      .sort((a, b) => b.folder.length - a.folder.length)[0];
    if (!rule || path === rule.template || (this.templateFolder && path.startsWith(this.templateFolder + '/'))) return body;
    return this.templates.newContent(rule.template, path);
  }
  dispose() {
    this.stopped = true; this.generation++;
    this.lifetime.abort();
    for (const entry of this.loaded.values()) { entry.abort.abort(); entry.dispose(); }
    this.loaded.clear(); this.builtin.splice(0).forEach(stop => stop());
    this.settings = undefined; this.templates.cancel(); this.loading = undefined;
    window.removeEventListener('vault-changed', this.onVaultChanged);
  }
}
