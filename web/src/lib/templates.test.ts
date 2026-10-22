import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { App } from './obsidian/runtime';
import type { CommandContext } from './commands';

// Prepared regression source only; execution remains user-deferred.
// Mock the insertion Seam, rather than booting the application or a DOM editor.
const insertion = vi.hoisted(() => vi.fn());
vi.mock('./writing/editing', () => ({ insertWritingTemplate: insertion }));
vi.mock('./commands', () => ({ commandContext: () => { throw new Error('Supply a captured test context'); } }));
vi.mock('./obsidian/vault', () => ({
  normalizePath: (path: string) => path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\.\//, '')
    .replace(/^\/+|\/+$/g, '').normalize('NFC'),
}));

import { renderTemplate, Templates, type TemplateEnvironment } from './templates';

function environment(files: Record<string, string> = {}) {
  return {
    values: { title: '实验', path: 'Notes/实验.md', folder: 'Notes', selection: '', properties: {} } as Record<string, unknown>,
    execute: vi.fn(async (_id: string, _args: unknown): Promise<unknown> => ''),
    read: vi.fn(async (path: string) => {
      if (!Object.hasOwn(files, path)) throw new Error(`Missing fixture: ${path}`);
      return files[path];
    }),
    assertCurrent: vi.fn(),
  } satisfies TemplateEnvironment;
}

beforeEach(() => insertion.mockClear());

describe('declarative template generation', () => {
  it('keeps command output literal, including template and snippet syntax', async () => {
    const env = environment();
    const literal = '<% command "unexpected" {} %> $1 ${0:default} [[0]] \\frac{a}{b}';
    env.execute.mockResolvedValue(literal);
    const result = await renderTemplate('<% command "user:text" {} %><% cursor 1 %>', 'literal.md', env);
    expect(result).toEqual({ text: literal, cursors: [{ order: 1, from: literal.length, to: literal.length }] });
    expect(env.execute).toHaveBeenCalledExactlyOnceWith('user:text', {});
  });

  it('awaits sequential commands and reuses stored results in nested arguments', async () => {
    const env = environment(), events: string[] = [];
    env.execute.mockImplementation(async (id, args) => {
      events.push(id);
      if (id === 'user:course') {
        await Promise.resolve();
        return { name: '热力学', tags: ['化学'] };
      }
      expect(args).toEqual({ label: '热力学', nested: [['化学']] });
      return true; // An action's status must not become note text.
    });
    const source = '<% let course = command "user:course" {} %><% course.name %> / <% course.name %>' +
      '<% do "user:remember" {"label":{"$var":"course.name"},"nested":[{"$var":"course.tags"}]} %>';
    expect((await renderTemplate(source, 'sequential.md', env)).text).toBe('热力学 / 热力学');
    expect(events).toEqual(['user:course', 'user:remember']);
  });

  it('normalizes CRLF and offsets nested cursor groups in the final text', async () => {
    const env = environment({
      'Parts/A.md': 'A<% cursor 1 %><% include "Parts/B.md" %>',
      'Parts/B.md': 'B<% cursor 2 %>',
    });
    const result = await renderTemplate('\ufeff前\r\n<% include "Parts/A.md" %>后<% cursor 3 %>', 'outer.md', env);
    expect(result).toEqual({ text: '前\nAB后', cursors: [
      { order: 1, from: 3, to: 3 }, { order: 2, from: 4, to: 4 }, { order: 3, from: 5, to: 5 },
    ] });
    expect(env.read.mock.calls).toEqual([['Parts/A.md'], ['Parts/B.md']]);
  });

  it('rejects an include cycle without reading the same ancestor again', async () => {
    const env = environment({ 'B.md': '<% include "A.md" %>', 'A.md': '<% include "B.md" %>' });
    await expect(renderTemplate('<% include "B.md" %>', 'A.md', env)).rejects.toThrow('A.md → B.md → A.md');
    expect(env.read).toHaveBeenCalledTimes(2);
  });

  it('handles escaped delimiters and quoted closing delimiters as literal data', async () => {
    const env = environment();
    env.execute.mockImplementation(async (_id, args) => (args as { text: string }).text);
    const result = await renderTemplate('<%% title %> / <% command "user:text" {"text":"inside %> string"} %>', 'escaped.md', env);
    expect(result.text).toBe('<% title %> / inside %> string');
  });

  it('reads dotted YAML keys literally while keeping dotted access for variables', async () => {
    const env = environment();
    env.values.properties = { 'course.name': '物理化学', course: { name: 'wrong' } };
    expect((await renderTemplate('<% property "course.name" %>', 'property.md', env)).text).toBe('物理化学');
  });

  it('reports the actual template and line for syntax and asynchronous failures', async () => {
    const env = environment();
    await expect(renderTemplate('first\r\nsecond\r\n<%* app.vault.delete(file) %>', 'syntax.md', env))
      .rejects.toThrow('syntax.md:3');
    env.execute.mockRejectedValue(new Error('service unavailable'));
    await expect(renderTemplate('first\r\n<% command "user:fetch" {} %>', 'failure.md', env))
      .rejects.toThrow('failure.md:2：service unavailable');
  });

  it('does not stringify an object or boolean accidentally', async () => {
    const env = environment();
    for (const value of [{ name: 'result' }, true]) {
      env.execute.mockResolvedValue(value);
      await expect(renderTemplate('<% command "user:value" {} %>', 'typed-output.md', env))
        .rejects.toThrow('插入结果必须是文本或数值');
    }
  });
});

function insertionFixture(source: string) {
  const state = EditorState.create({ doc: 'before selected after', selection: { anchor: 7, head: 15 } });
  const view = { state, focus: vi.fn() } as unknown as EditorView;
  const context: CommandContext = { source: 'template', path: 'Notes/实验.md', selection: 'selected', view, state,
    stack: [], now: new Date('2026-10-22T12:00:00Z'), assertCurrent: vi.fn() };
  const file = { path: 'Templates/实验.md', basename: '实验' };
  const execute = vi.fn(async (_id: string, _args: unknown, _context: CommandContext): Promise<unknown> => 'generated');
  const app = {
    vault: { getFileByPath: (path: string) => path === file.path ? file : { path, basename: '实验' },
      cachedRead: vi.fn(async () => source) },
    metadataCache: { getFileCache: () => ({ frontmatter: {} }) }, commands: { execute },
  } as unknown as App;
  return { templates: new Templates(app), context, view, execute };
}

describe('single template insertion', () => {
  it('leaves the note unapplied after an asynchronous command failure', async () => {
    const { templates, context, execute } = insertionFixture('prefix <% command "user:fetch" {} %> suffix');
    execute.mockRejectedValue(new Error('failed'));
    await expect(templates.insert('Templates/实验.md', context)).rejects.toThrow('failed');
    expect(insertion).not.toHaveBeenCalled();
  });

  it('preserves cancellation and leaves the note unapplied', async () => {
    const { templates, context, execute } = insertionFixture('prefix <% command "input:prompt" {} %>');
    const canceled = new DOMException('Canceled', 'AbortError');
    execute.mockRejectedValue(canceled);
    await expect(templates.insert('Templates/实验.md', context)).rejects.toBe(canceled);
    expect(insertion).not.toHaveBeenCalled();
  });

  it('cancels a pending helper when the template host is released', async () => {
    const { templates, context, execute } = insertionFixture('<% command "input:prompt" {} %>');
    let entered!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    execute.mockImplementation((_id, _args, scoped) => new Promise((_resolve, reject) => {
      scoped.signal!.addEventListener('abort', () => reject(new DOMException('Disposed', 'AbortError')), { once: true });
      entered();
    }));
    const pending = templates.insert('Templates/实验.md', context);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await waiting; templates.cancel(); await rejected;
    expect(insertion).not.toHaveBeenCalled();
  });

  it('rechecks the captured target after an await before committing one insertion', async () => {
    const { templates, context, execute } = insertionFixture('prefix <% command "user:fetch" {} %>');
    let stale = false;
    context.assertCurrent = () => { if (stale) throw new Error('target changed'); };
    execute.mockImplementation(async () => { stale = true; return 'late result'; });
    await expect(templates.insert('Templates/实验.md', context)).rejects.toThrow('target changed');
    expect(insertion).not.toHaveBeenCalled();
  });

  it('commits completed output only once with the captured selection', async () => {
    const { templates, context, view } = insertionFixture('<% command "user:fetch" {} %><% cursor 1 %>');
    await templates.insert('Templates/实验.md', context);
    expect(insertion).toHaveBeenCalledExactlyOnceWith(view, 7, 15, 'generated', [{ order: 1, from: 9, to: 9 }]);
  });
});
