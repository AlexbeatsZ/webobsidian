import type { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { App } from './obsidian/runtime';
import { Events } from './obsidian/events';
import { Editor } from './obsidian/editor';
import { MarkdownView } from './obsidian/workspace';
import { getActiveEditor, getEditorForPath } from './activeEditor';
import { contextOf } from './renderContext';
import { documents } from './documents';
import { useStore } from './store';
import { eventHotkey, hotkeySignature, type Hotkey } from '@webobsidian/search-core';
import { hotkeySettings } from './search';

export interface CommandContext {
  source: 'user' | 'template' | 'script';
  paths?: readonly string[];
  path: string;
  selection: string;
  view: EditorView | null;
  state?: EditorState;
  signal?: AbortSignal;
  stack: readonly string[];
  now: Date;
  assertCurrent(): void;
}

/** Capture once before async work; never rediscover a different target after await. */
export function commandContext(source: CommandContext['source'] = 'user', path?: string): CommandContext {
  const view = path !== undefined ? null : getActiveEditor();
  const target = path ?? (view ? contextOf(view).sourcePath : useStore.getState().activePath ?? '');
  const state = view?.state, session = documents.get(target), version = session?.snapshot.version;
  const activePath = useStore.getState().activePath;
  return {
    source, path: target, view, state, stack: [], now: new Date(),
    selection: state ? state.sliceDoc(state.selection.main.from, state.selection.main.to) : '',
    assertCurrent() {
      if (useStore.getState().vaultSessionStale) throw new Error('Vault 已切换，请重新加载应用');
      if ((path === undefined && useStore.getState().activePath !== activePath) || (view && (view.state.doc !== state!.doc ||
          !view.state.selection.eq(state!.selection) || getEditorForPath(target) !== view)))
        throw new Error('编辑位置已变化，请重新执行');
      if (session && (documents.get(target) !== session || session.snapshot.version !== version || session.snapshot.conflict))
        throw new Error('目标文档已变化或存在冲突，请重新执行');
    },
  };
}

export type Command = {
  id: string; name: string;
  hotkeys?: { modifiers: string[]; key: string }[];
  callback?: () => unknown;
  checkCallback?: (checking: boolean) => unknown;
  editorCallback?: (editor: Editor, view: MarkdownView) => unknown;
  editorCheckCallback?: (checking: boolean, editor: Editor, view: MarkdownView) => unknown;
  run?: (args: unknown, context: CommandContext) => unknown;
  available?: (context: CommandContext) => boolean;
  hotkeyScope?: 'editor';
};
export type NativeCommand = { id: string; title: string; run: () => unknown; hotkeys?: Hotkey[]; hotkeyScope?: 'editor'; available?: (context: CommandContext) => boolean };

/** One invocation contract for native contributions, Obsidian adapters and user JS. */
export class CommandManager extends Events {
  private nativeSource?: readonly NativeCommand[];
  private native = new Map<string, Command>();
  constructor(private app: App, private getNative: () => readonly NativeCommand[],
    readonly registered: Map<string, Command>, readonly changed: () => void,
    private resolveId: (id: string) => string = id => id, private getRevision = () => 0) { super(); }
  private nativeCommands() {
    const source = this.getNative();
    if (source !== this.nativeSource) {
      this.nativeSource = source;
      this.native = new Map(source.map(c => [c.id, { id: c.id, name: c.title, callback: c.run, hotkeys: c.hotkeys, available: c.available, hotkeyScope: c.hotkeyScope }]));
    }
    return this.native;
  }
  get commands() { return Object.fromEntries(this.listCommands().map(c => [c.id, c])); }
  listCommands() {
    const native = this.nativeCommands();
    return [...native.values(), ...[...this.registered.values()].filter(c => !native.has(c.id))];
  }
  findCommand(id: string) { id = this.resolveId(id); return this.nativeCommands().get(id) ?? this.registered.get(id); }
  getDefaultHotkeys(id: string): Hotkey[] { return this.findCommand(id)?.hotkeys ?? []; }
  getHotkeys(id: string): Hotkey[] {
    id = this.resolveId(id);
    return hotkeySettings().bindings[id] ?? this.getDefaultHotkeys(id);
  }
  /** Settings also keeps imported commands whose plugin/capability is absent. */
  hotkeyCatalog() {
    const commands = this.listCommands(), known = new Set(commands.map(command => command.id));
    return [...commands.map(command => ({ ...command, installed: true })),
      ...Object.keys(hotkeySettings().bindings).filter(id => !known.has(id)).map(id => ({ id, name: id, installed: false }))];
  }
  private keyCache?: { config: ReturnType<typeof hotkeySettings>; revision: number; native: readonly NativeCommand[];
    bindings: Map<string, { command: Command; custom: boolean }[]>; blocked: Set<string> };
  private keyIndex() {
    const config = hotkeySettings(), revision = this.getRevision(), native = this.getNative();
    if (this.keyCache?.config === config && this.keyCache.revision === revision && this.keyCache.native === native) return this.keyCache;
    const bindings = new Map<string, { command: Command; custom: boolean }[]>(), blocked = new Set<string>();
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
    for (const command of this.listCommands()) {
      const custom = Object.hasOwn(config.bindings, command.id);
      for (const binding of this.getHotkeys(command.id)) {
        const signature = hotkeySignature(binding, mac);
        bindings.set(signature, [...bindings.get(signature) ?? [], { command, custom }]);
      }
      if (custom) for (const binding of command.hotkeys ?? []) blocked.add(hotkeySignature(binding, mac));
    }
    return this.keyCache = { config, revision, native, bindings, blocked };
  }
  dispatchHotkey(event: KeyboardEvent): boolean {
    if (event.defaultPrevented || event.isComposing || event.getModifierState('AltGraph')) return false;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('[data-hotkey-recorder], [role="dialog"], .modal-container, .settings-overlay, .palette-backdrop')) return false;
    const binding = eventHotkey(event);
    if (!binding) return false;
    const index = this.keyIndex(), signature = hotkeySignature(binding, /Mac|iPhone|iPad/.test(navigator.platform));
    const inEditor = !!target?.closest('.cm-editor'), typing = !!target?.closest('input, textarea, [contenteditable="true"]');
    let candidates = (index.bindings.get(signature) ?? []).filter(({ command }) => !command.hotkeyScope || inEditor);
    if (typing && !inEditor && !event.ctrlKey && !event.metaKey && !event.altKey) return false;
    // User bindings replace defaults. Equal-priority collisions are never resolved
    // by registration order; the settings page exposes both affected commands.
    if (candidates.some(candidate => candidate.custom)) candidates = candidates.filter(candidate => candidate.custom);
    if (candidates.length > 1) {
      if (!event.repeat) useStore.getState().notify(`快捷键冲突：${candidates.map(({ command }) => command.name).join('、')}。请在快捷键设置中调整。`);
      return true;
    }
    if (candidates.length === 1) { this.executeCommandById(candidates[0].command.id); return true; }
    return inEditor && index.blocked.has(signature);
  }
  register(command: Command): () => void {
    if (!command.id || this.findCommand(command.id)) throw new Error(`指令 ID 已存在：${command.id}`);
    this.registered.set(command.id, command); this.changed();
    return () => { if (this.registered.get(command.id) === command) { this.registered.delete(command.id); this.changed(); } };
  }
  private invoke(command: Command, checking: boolean, args: unknown, context: CommandContext): unknown {
    context.signal?.throwIfAborted();
    if (command.available && !command.available(context)) return false;
    if (command.run) return checking ? true : command.run(args, context);
    if (context.path && context.path !== this.app.workspace.getActiveFile()?.path) return false;
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (context.view && view?.editor?.cm !== context.view && (command.editorCallback || command.editorCheckCallback)) return false;
    const target = context.view ? new Editor(context.view) : view?.editor;
    if (command.editorCheckCallback || command.editorCallback) {
      if (!target || target.cm.state.readOnly || !view) return false;
      if (command.editorCheckCallback) return command.editorCheckCallback(checking, target, view);
      return checking ? true : command.editorCallback!(target, view);
    }
    if (command.checkCallback) return command.checkCallback(checking);
    return command.callback ? (checking ? true : command.callback()) : false;
  }
  canExecute(id: string, context = commandContext()): boolean {
    const command = this.findCommand(id);
    if (!command) return false;
    try {
      const value = this.invoke(command, true, undefined, context);
      if (value && typeof (value as Promise<unknown>).then === 'function') {
        void Promise.resolve(value).catch(console.error); return false;
      }
      return value !== false;
    }
    catch { return false; }
  }
  private async runChecked(command: Command, args: unknown, context: CommandContext): Promise<unknown> {
    const id = command.id;
    context.assertCurrent(); context.signal?.throwIfAborted();
    if (context.stack.length >= 32 || context.stack.includes(id)) throw new Error(`指令循环调用：${[...context.stack, id].join(' → ')}`);
    const nested = { ...context, stack: [...context.stack, id] };
    return await this.invoke(command, false, args, nested);
  }
  async execute(id: string, args: unknown = {}, context = commandContext()): Promise<unknown> {
    context.signal?.throwIfAborted();
    const command = this.findCommand(id);
    if (!command) throw new Error(`指令不存在：${id}`);
    if (!this.canExecute(command.id, context)) throw new Error(`当前无法执行指令：${command.name}`);
    return this.runChecked(command, args, context);
  }
  /** Obsidian compatibility: boolean means dispatched; execute() awaits the result. */
  executeCommandById(id: string): boolean {
    const context = commandContext(), command = this.findCommand(id);
    if (!command || !this.canExecute(command.id, context)) return false;
    void this.runChecked(command, {}, context).catch(error => { if (!(error instanceof DOMException && error.name === 'AbortError')) useStore.getState().notify(String(error)); });
    return true;
  }
}
