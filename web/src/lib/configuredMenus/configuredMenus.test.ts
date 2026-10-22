// Pure regression cases authored for later acceptance. Not executed under the
// current static-only instruction; TypeScript checks still include this file.
import { describe, expect, it, vi } from 'vitest';
import { compileMenuConfig, parseMenuConfig, resolveMenuInclude } from './config';
import { MenuConfigurationController } from './controller';
import { snapshotMenuContext, transformMenu } from './transform';
import type { MenuCommandHost, MenuConfig, MenuSource, MenuStorage } from './types';

const host = (): MenuCommandHost => ({ hasCommand: () => true, executeCommand: vi.fn(() => true), notify: vi.fn(), openSettings: vi.fn() });
const fileContext = snapshotMenuContext({ kind: 'file', paths: ['notes/a.md'], modifiers: { shift: false } });

describe('configured menu model and schema', () => {
  it('parses JSONC and points at a misspelled field', () => {
    expect(parseMenuConfig('menu.jsonc', '{ // comment\n "version": 1, "items": [], }').config?.version).toBe(1);
    const invalid = parseMenuConfig('menu.jsonc', '{\n"version":1,\n"rulse": []\n}');
    expect(invalid.config).toBeUndefined();
    expect(invalid.diagnostics[0]).toMatchObject({ file: 'menu.jsonc', line: 3 });
    expect(parseMenuConfig('menu.jsonc', '{"version":1,"version":1}').diagnostics[0].message).toContain('Duplicate');
  });
  it('confines includes and supports relative imports', () => {
    expect(resolveMenuInclude('imports/a.jsonc', '../shared/b.jsonc')).toBe('shared/b.jsonc');
    for (const path of ['../escape.jsonc', 'https://x/a.jsonc', 'x\\a.jsonc', 'CON.jsonc', 'a.json']) expect(() => resolveMenuInclude('menu.jsonc', path)).toThrow();
  });
  it('preserves callbacks, disabled, checked, children and input objects', () => {
    const callback = vi.fn();
    const input = [{ id: 'file:rename', label: 'Rename', disabled: true, checked: true, onClick: callback }, { label: '', separator: true }, { label: '', separator: true }, { id: 'parent', label: 'Parent', submenu: [{ label: 'Child', onClick: callback }] }];
    const output = transformMenu(input, compileMenuConfig([{ version: 1, rules: [{ match: { id: 'file:rename' }, title: '改名' }] }]), fileContext);
    expect(output[0]).toMatchObject({ id: 'file:rename', label: '改名', disabled: true, checked: true, onClick: callback });
    expect(output.filter((x) => x.separator)).toHaveLength(1);
    expect(output[2].submenu?.[0].onClick).toBe(callback);
    expect(input[0].label).toBe('Rename');
  });
  it('evaluates snapshot conditions, moves into submenus and preserves weak identity after rename', () => {
    const config: MenuConfig = { version: 1, items: [{ id: 'custom:tools', title: 'Tools', submenu: [] }], rules: [
      { match: { weak: { title: 'Plugin action', section: 'plugin' } }, title: 'Renamed' },
      { match: { weak: { title: 'Plugin action', section: 'plugin' } }, move: { parent: 'custom:tools' } },
      { match: { id: 'delete' }, when: { contexts: ['file'], fileTypes: ['md'], modifiers: { shift: false } }, hide: true },
    ] };
    const output = transformMenu([{ label: 'Plugin action', section: 'plugin' }, { id: 'delete', label: 'Delete' }], compileMenuConfig([config]), fileContext);
    expect(output.filter((x) => !x.separator)).toHaveLength(1);
    expect(output[0].submenu?.[0].label).toBe('Renamed');
    // Explicit weak matches never affect stable IDs, even with identical titles.
    expect(transformMenu([{ id: 'plugin:stable', label: 'Plugin action', section: 'plugin' }], compileMenuConfig([config]), fileContext)[0].label).toBe('Plugin action');
  });
  it('does not execute commands after context changes', () => {
    const h = host(); h.isContextCurrent = () => false;
    const output = transformMenu([], compileMenuConfig([{ version: 1, items: [{ id: 'custom:run', title: 'Run', command: 'save' }] }]), fileContext, h);
    output[0].onClick?.();
    expect(h.executeCommand).not.toHaveBeenCalled();
    expect(h.notify).toHaveBeenCalled();
  });
  it('does not create submenu cycles or pick an ambiguous parent', () => {
    const config: MenuConfig = { version: 1, rules: [{ match: { id: 'parent' }, move: { parent: 'child' } }, { match: { id: 'a' }, move: { parent: 'duplicate' } }] };
    const output = transformMenu([{ id: 'parent', label: 'Parent', submenu: [{ id: 'child', label: 'Child', submenu: [{ label: 'Leaf' }] }] }, { id: 'a', label: 'A' }, { id: 'duplicate', label: 'D1', submenu: [] }, { id: 'duplicate', label: 'D2', submenu: [] }], compileMenuConfig([config]), fileContext);
    expect(output[0].id).toBe('parent');
    expect(output[1].id).toBe('a');
  });
});

describe('compiled menu configuration lifecycle', () => {
  const memoryStorage = (files: Record<string, string>) => {
    let version = 0;
    const storage: MenuStorage = {
      read: async (path) => ({ path, content: files[path] ?? '', exists: path in files, revision: String(version), vault: 'fixture-vault' }),
      write: async (path, content) => { files[path] = content; version++; return storage.read(path); },
    };
    return storage;
  };
  it('applies included rules first, retains last valid config and reports cycles', async () => {
    const files = { 'menu.jsonc': '{"version":1,"includes":["imports/file.jsonc"],"rules":[{"match":{"id":"x"},"title":"Root"}]}', 'imports/file.jsonc': '{"version":1,"rules":[{"match":{"id":"x"},"title":"Import"}]}' };
    const controller = new MenuConfigurationController(memoryStorage(files), host());
    expect(await controller.reload()).toBe(true);
    expect(controller.apply([{ id: 'x', label: 'Original' }], fileContext)[0].label).toBe('Root');
    files['imports/file.jsonc'] = '{"version":1,"includes":["../menu.jsonc"]}';
    expect(await controller.reload()).toBe(false);
    expect(controller.getSnapshot().diagnostics[0].message).toContain('Circular');
    expect(controller.apply([{ id: 'x', label: 'Original' }], fileContext)[0].label).toBe('Root');
    controller.dispose();
  });
  it('does not publish a superseded asynchronous reload', async () => {
    let resolveFirst!: (source: MenuSource) => void;
    let count = 0;
    const storage: MenuStorage = {
      read: (path) => ++count === 1 ? new Promise((resolve) => { resolveFirst = resolve; }) : Promise.resolve({ path, content: '{"version":1,"rules":[{"match":{"id":"x"},"title":"New"}]}', exists: true, vault: 'fixture-vault' }),
      write: async () => { throw new Error('unused'); },
    };
    const controller = new MenuConfigurationController(storage, host());
    const old = controller.reload();
    await controller.reload();
    resolveFirst({ path: 'menu.jsonc', content: '{"version":1}', exists: true, vault: 'fixture-vault' });
    expect(await old).toBe(false);
    expect(controller.apply([{ id: 'x', label: 'Original' }], fileContext)[0].label).toBe('New');
  });
  it('stops reading includes after the Vault session is disposed', async () => {
    let resolveRead!: (source: MenuSource) => void;
    const read = vi.fn(() => new Promise<MenuSource>((resolve) => { resolveRead = resolve; }));
    const storage: MenuStorage = { read, write: async () => { throw new Error('unused'); } };
    const controller = new MenuConfigurationController(storage, host());
    const loading = controller.reload();
    controller.dispose();
    resolveRead({ path: 'menu.jsonc', content: '{"version":1,"includes":["imports/a.jsonc"]}', exists: true, vault: 'fixture-vault' });
    expect(await loading).toBe(false);
    expect(read).toHaveBeenCalledTimes(1);
  });
  it('rejects callbacks retained from a disposed menu session', () => {
    const callback = vi.fn();
    const controller = new MenuConfigurationController(memoryStorage({}), host());
    const menu = controller.apply([{ label: 'Original action', onClick: callback }], fileContext);
    controller.dispose();
    menu[0].onClick?.();
    expect(callback).not.toHaveBeenCalled();
  });
});
