import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';

const state = vi.hoisted(() => ({ root: '', dataDir: '' }));
vi.mock('../config.js', () => ({ config: { get dataDir() { return state.dataDir; } } }));
vi.mock('./settings.js', () => ({ getSettings: async () => ({ vault: { path: state.root }, nativeFeatures: {} }) }));
vi.mock('./git.js', () => ({ scheduleAutoCommitOnSave: vi.fn() }));
vi.mock('./fileupdates.js', () => ({ queueFileUpdate: vi.fn(async () => ({ status: 'indexed' })) }));
vi.mock('./realtime.js', () => ({ broadcast: vi.fn() }));
vi.mock('./search.js', () => ({ qmd: {} }));
vi.mock('./mcpContext.js', () => ({ mcpContext: { list: async () => ({
  vault: createHash('sha256').update(state.root).digest('base64url'), items: [] }) } }));
vi.mock('./operationWorkspace.js', () => ({
  captureWorkspaces: vi.fn(async () => [{ clientId: 'local', stale: false, document: null }]),
  applyFileInWorkspace: vi.fn(), applyInWorkspace: vi.fn(),
}));
import { callOperation, mcpInstructionNotes } from './operations.js';
import { readMcpPreferences, saveMcpPreferences } from './mcpPreferences.js';
import { standingInstructionText } from '../operations/mcpServer.js';

const base = path.join(os.tmpdir(), '.agents');
let directory = '';
beforeEach(async () => {
  await fs.mkdir(base, { recursive: true });
  directory = await fs.mkdtemp(path.join(base, 'mcp-instructions-'));
  state.root = path.join(directory, 'vault'); state.dataDir = path.join(directory, 'data');
  await fs.mkdir(path.join(state.root, '@管理'), { recursive: true });
  await fs.writeFile(path.join(state.root, '@管理', '笔记规范.md'), '# 规范\n公式不手动编号。\n');
});
afterEach(async () => {
  if (path.dirname(directory) !== base || !path.basename(directory).startsWith('mcp-instructions-')) throw new Error('Unsafe fixture path');
  await fs.rm(directory, { recursive: true, force: true });
});

it('stores chosen notes in the Vault configuration and rejects hidden or non-Markdown paths', async () => {
  const empty = await readMcpPreferences();
  expect(empty.preferences.instructionNotes).toEqual([]);
  const saved = await saveMcpPreferences(empty.source, { instructionNotes: ['@管理/笔记规范.md', '@管理/笔记规范.md'] });
  expect(saved.preferences.instructionNotes).toEqual(['@管理/笔记规范.md']);
  expect(JSON.parse(await fs.readFile(path.join(state.root, '.obsidian/webobsidian/mcp.jsonc'), 'utf8')))
    .toEqual({ instructionNotes: ['@管理/笔记规范.md'] });
  await expect(saveMcpPreferences(saved.source, { instructionNotes: ['.obsidian/app.md'] })).rejects.toThrow();
  await expect(saveMcpPreferences(saved.source, { instructionNotes: ['image.png'] })).rejects.toThrow();
  // A stale revision cannot overwrite a newer list.
  await saveMcpPreferences(saved.source, { instructionNotes: [] });
  await expect(saveMcpPreferences(saved.source, { instructionNotes: ['@管理/笔记规范.md'] })).rejects.toThrow();
});

it('get_context always carries the current text of standing instruction notes', async () => {
  expect(await callOperation('obsidian_get_context', {})).not.toHaveProperty('standing_instructions');
  const { source } = await readMcpPreferences();
  await saveMcpPreferences(source, { instructionNotes: ['@管理/笔记规范.md', 'gone.md'] });
  const result = await callOperation('obsidian_get_context', {}) as any;
  expect(result.source).toBe('no_active_note');
  expect(result.standing_instructions.notice).toMatch(/standing instructions/);
  expect(result.standing_instructions.notes[0]).toMatchObject({ path: '@管理/笔记规范.md', link: '[[@管理/笔记规范]]',
    content: '# 规范\n公式不手动编号。\n', truncated: false });
  expect(result.standing_instructions.notes[1]).toEqual({ path: 'gone.md', link: '[[gone]]', missing: true });
  await fs.writeFile(path.join(state.root, '@管理', '笔记规范.md'), '# 规范 v2\n');
  expect((await callOperation('obsidian_get_context', {}) as any).standing_instructions.notes[0].content).toBe('# 规范 v2\n');
});

it('connection instructions list links only, and long notes are truncated with a flag', async () => {
  await fs.writeFile(path.join(state.root, 'long.md'), 'x'.repeat(40000));
  const { source } = await readMcpPreferences();
  await saveMcpPreferences(source, { instructionNotes: ['long.md'] });
  expect(await mcpInstructionNotes(false)).toEqual([{ path: 'long.md', link: '[[long]]' }]);
  const [note] = await mcpInstructionNotes(true);
  expect(note.content).toHaveLength(32768);
  expect(note.truncated).toBe(true);
  expect(standingInstructionText([])).toBe('');
  expect(standingInstructionText([{ path: 'long.md', link: '[[long]]' }])).toContain('[[long]] (long.md)');
});
