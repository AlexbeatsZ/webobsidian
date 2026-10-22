import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { App } from './obsidian/runtime';

// Prepared regression source only; no application, Vault or DOM is started.
const host = vi.hoisted(() => ({
  active: null as EditorView | null,
  views: new Map<string, EditorView>(), paths: new WeakMap<object, string>(),
  sessions: new Map<string, { snapshot: { version: number; conflict: boolean } }>(),
  state: { activePath: 'A.md', vaultSessionStale: false, notify: vi.fn() },
}));
vi.mock('./activeEditor', () => ({ getActiveEditor: () => host.active,
  getEditorForPath: (path: string) => host.views.get(path) ?? null }));
vi.mock('./renderContext', () => ({ contextOf: (view: object) => ({ sourcePath: host.paths.get(view) ?? '' }) }));
vi.mock('./documents', () => ({ documents: { get: (path: string) => host.sessions.get(path) } }));
vi.mock('./store', () => ({ useStore: { getState: () => host.state } }));
vi.mock('./obsidian/editor', () => ({ Editor: class { constructor(public cm: EditorView) {} } }));
vi.mock('./obsidian/workspace', () => ({ MarkdownView: class {} }));

import { CommandManager, commandContext, type Command, type CommandContext } from './commands';

beforeEach(() => {
  host.active = null; host.views.clear(); host.sessions.clear(); host.paths = new WeakMap();
  host.state.activePath = 'A.md'; host.state.vaultSessionStale = false; host.state.notify.mockClear();
});

function fixture(native: { id: string; title: string; run(): unknown }[] = []) {
  const activeView = { editor: { cm: null as EditorView | null } };
  const app = { workspace: {
    getActiveFile: () => ({ path: host.state.activePath }), getActiveViewOfType: () => activeView,
  } } as unknown as App;
  const registered = new Map<string, Command>();
  const commands = new CommandManager(app, () => native, registered, vi.fn(), id => id === 'old:save' ? 'save' : id);
  return { commands, registered, activeView };
}
function captured(): CommandContext {
  return { source: 'template', path: 'A.md', selection: 'selected', view: null, stack: [],
    now: new Date('2026-10-22T12:00:00Z'), assertCurrent: vi.fn() };
}
function mounted(path = 'A.md') {
  const raw = { state: EditorState.create({ doc: 'selected text', selection: { anchor: 0, head: 8 } }) };
  const view = raw as unknown as EditorView;
  host.active = view; host.views.set(path, view); host.paths.set(view, path);
  return { raw, view };
}

describe('one awaited command invocation contract', () => {
  it('awaits the actual result and passes arguments and captured context through nesting', async () => {
    const { commands } = fixture();
    const context = captured(), args = { input: '值' };
    let release!: (value: unknown) => void;
    const run = vi.fn((_args: unknown, nested: CommandContext) => {
      expect(nested.path).toBe('A.md'); expect(nested.now).toBe(context.now);
      expect(nested.selection).toBe('selected'); expect(nested.stack).toEqual(['user:async']);
      return new Promise<unknown>(resolve => { release = resolve; });
    });
    commands.register({ id: 'user:async', name: 'Async', run });
    const pending = commands.execute('user:async', args, context);
    expect(run).toHaveBeenCalledTimes(1); expect(run.mock.calls[0][0]).toBe(args);
    const value = { answer: 42 }; release(value);
    await expect(pending).resolves.toBe(value);
    expect(context.stack).toEqual([]);
  });

  it('checks availability without running the action, then rejects unavailable execution', async () => {
    const { commands } = fixture(), run = vi.fn(), context = captured();
    commands.register({ id: 'user:disabled', name: 'Disabled', available: () => false, run });
    expect(commands.canExecute('user:disabled', context)).toBe(false);
    await expect(commands.execute('user:disabled', {}, context)).rejects.toThrow('当前无法执行');
    expect(run).not.toHaveBeenCalled();
  });

  it('keeps boolean dispatch and legacy aliases while awaiting native results through execute', async () => {
    const run = vi.fn(async () => 'saved');
    const { commands } = fixture([{ id: 'save', title: 'Save', run }]);
    expect(commands.executeCommandById('missing')).toBe(false);
    expect(commands.executeCommandById('old:save')).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    await expect(commands.execute('old:save', {}, captured())).resolves.toBe('saved');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('propagates asynchronous failures to awaited callers', async () => {
    const { commands } = fixture(), failure = new Error('network failed');
    commands.register({ id: 'user:fail', name: 'Fail', run: async () => { throw failure; } });
    await expect(commands.execute('user:fail', {}, captured())).rejects.toBe(failure);
  });

  it('rejects recursive calls through the shared stack before executing a command twice', async () => {
    const { commands } = fixture(), context = captured();
    const first = vi.fn((_args: unknown, nested: CommandContext) => commands.execute('user:second', {}, nested));
    const second = vi.fn((_args: unknown, nested: CommandContext) => commands.execute('user:first', {}, nested));
    commands.register({ id: 'user:first', name: 'First', run: first });
    commands.register({ id: 'user:second', name: 'Second', run: second });
    await expect(commands.execute('user:first', {}, context)).rejects.toThrow('user:first → user:second → user:first');
    expect(first).toHaveBeenCalledTimes(1); expect(second).toHaveBeenCalledTimes(1);
  });

  it('does not redirect a captured document to an unrelated active legacy callback', async () => {
    const native = vi.fn(), { commands } = fixture([{ id: 'save', title: 'Save', run: native }]);
    const context = captured(); context.path = 'Other.md';
    expect(commands.canExecute('save', context)).toBe(false);
    await expect(commands.execute('save', {}, context)).rejects.toThrow('当前无法执行');
    expect(native).not.toHaveBeenCalled();
  });

  it('rejects a mixed editor/MarkdownView pair instead of invoking the plugin on two targets', () => {
    const { commands, activeView } = fixture(), { view } = mounted(), callback = vi.fn();
    activeView.editor.cm = {} as EditorView;
    commands.register({ id: 'plugin:edit', name: 'Edit', editorCallback: callback });
    const context = captured(); context.view = view;
    expect(commands.canExecute('plugin:edit', context)).toBe(false);
    expect(callback).not.toHaveBeenCalled();
  });

  it('unregisters a contribution without deleting a later replacement', () => {
    const { commands, registered } = fixture();
    const dispose = commands.register({ id: 'user:item', name: 'Original', run: () => 'first' });
    expect(() => commands.register({ id: 'user:item', name: 'Duplicate' })).toThrow('已存在');
    const replacement: Command = { id: 'user:item', name: 'Replacement', run: () => 'second' };
    registered.set(replacement.id, replacement); dispose();
    expect(commands.findCommand(replacement.id)).toBe(replacement);
  });
});

describe('captured target validation', () => {
  it('rejects selection and document changes after capture', () => {
    const { raw } = mounted(), context = commandContext('template');
    expect(context.selection).toBe('selected'); context.assertCurrent();
    const original = raw.state;
    raw.state = original.update({ selection: { anchor: 1 } }).state;
    expect(() => context.assertCurrent()).toThrow('编辑位置已变化');
    raw.state = original.update({ changes: { from: 0, insert: 'new ' } }).state;
    expect(() => context.assertCurrent()).toThrow('编辑位置已变化');
  });

  it('binds a non-editor target to its session while allowing normal active-file changes', () => {
    const session = { snapshot: { version: 0, conflict: false } }; host.sessions.set('New.md', session);
    const context = commandContext('template', 'New.md');
    host.state.activePath = 'New.md'; context.assertCurrent();
    expect(context.view).toBeNull(); expect(context.path).toBe('New.md');
    session.snapshot.version++;
    expect(() => context.assertCurrent()).toThrow('目标文档已变化');
  });

  it('blocks invocation after a Vault switch or parent cancellation', async () => {
    const { commands } = fixture(), run = vi.fn();
    commands.register({ id: 'user:write', name: 'Write', run });
    const context = commandContext('template'); host.state.vaultSessionStale = true;
    await expect(commands.execute('user:write', {}, context)).rejects.toThrow('Vault 已切换');
    host.state.vaultSessionStale = false;
    const abort = new AbortController(); abort.abort();
    await expect(commands.execute('user:write', {}, { ...captured(), signal: abort.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(run).not.toHaveBeenCalled();
  });
});
