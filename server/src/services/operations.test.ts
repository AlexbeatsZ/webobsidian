import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const state = vi.hoisted(() => ({ root: '', dataDir: '', captures: [] as any[], native: {} }));
vi.mock('../config.js', () => ({ config: { get dataDir() { return state.dataDir; } } }));
vi.mock('./settings.js', () => ({ getSettings: async () => ({ vault: { path: state.root }, nativeFeatures: state.native }) }));
vi.mock('./git.js', () => ({ scheduleAutoCommitOnSave: vi.fn() }));
vi.mock('./fileupdates.js', () => ({ queueFileUpdate: vi.fn(async () => ({ status: 'indexed' })) }));
vi.mock('./realtime.js', () => ({ broadcast: vi.fn() }));
vi.mock('./search.js', () => ({ qmd: {} }));
vi.mock('./mcpContext.js', () => ({ mcpContext: {} }));
vi.mock('./operationWorkspace.js', () => ({
  captureWorkspaces: vi.fn(async () => state.captures),
  applyFileInWorkspace: vi.fn(), applyInWorkspace: vi.fn(),
}));
import { NativeReview, checkContentIds } from './operations.js';
import { VaultCatalog, catalog, replaceCatalog } from './catalog.js';
import { parseNote } from './markdown.js';
import { operationContract } from '../operations/contract.js';
import { applyFileInWorkspace, applyInWorkspace } from './operationWorkspace.js';
import * as vault from './vault.js';
import { readFileSnapshot } from './vaultFile.js';
import type { TextProposalInput } from '@webobsidian/markdown-core';

const base = path.join(os.tmpdir(), '.agents');
let directory = '', review: NativeReview;
const raw = '\ufeff# Original\r\n\r\n中文 😀\nTail\r';
const input = (operation: TextProposalInput['operations'][number], request_id = 'fixture') =>
  operationContract.obsidian_propose_changes.schema.parse({ request_id, operations: [operation] });
const create = (file = 'folder/new.md', content = '# New\n') => input({ kind: 'create', path: file, content });
const rename = async (to = 'renamed.md') => input({ kind: 'rename', path: 'original.md', to, base_revision: (await readFileSnapshot('original.md')).revision });
const read = (file: string) => fs.readFile(path.join(state.root, file), 'utf8');
beforeEach(async () => {
  await fs.mkdir(base, { recursive: true });
  directory = await fs.mkdtemp(path.join(base, 'mcp-note-operations-'));
  state.root = path.join(directory, 'vault'); state.dataDir = path.join(directory, 'data'); state.native = {};
  await fs.mkdir(state.root);
  await fs.writeFile(path.join(state.root, 'original.md'), raw);
  state.captures = [{ clientId: 'local', stale: false, document: null }];
  review = new NativeReview(); vi.clearAllMocks();
  vi.mocked(applyFileInWorkspace).mockImplementation(async (_id, op) => {
    if (op.kind === 'create') await vault.writeFileText(op.path, op.content, undefined, { createOnly: true });
    else await vault.rename(op.path, op.to, op.base_revision);
  });
});
afterEach(async () => {
  if (path.dirname(directory) !== base || !path.basename(directory).startsWith('mcp-note-operations-')) throw new Error('Unsafe fixture path');
  await fs.rm(directory, { recursive: true, force: true });
});

it('validates one create/rename/edit and rejects unsupported or mixed operations', () => {
  expect(create().operations[0].kind).toBe('create');
  expect(input({ kind: 'create', path: 'empty.md', content: '' }).operations[0]).toMatchObject({ content: '' });
  const schema = operationContract.obsidian_propose_changes.schema;
  for (const op of [{ kind: 'trash', path: 'a.md' }, { kind: 'create', path: 'a.md' },
    { kind: 'rename', path: 'a.md', to: 'b.md' }, { kind: 'create', path: 'a.md', content: '', overwrite: true }])
    expect(schema.safeParse({ request_id: 'bad', operations: [op] }).success).toBe(false);
  expect(schema.safeParse({ ...create(), operations: [create().operations[0], create().operations[0]] }).success).toBe(false);
});
it('persists a create candidate without note writes, supports identical retries and rejects altered retries', async () => {
  const request = create(), proposal = await review.propose(request);
  expect(proposal).toMatchObject({ kind: 'create', status: 'awaiting_user_review', applied_steps: 0 });
  await expect(read('folder/new.md')).rejects.toMatchObject({ code: 'ENOENT' });
  expect((await review.propose(request)).proposal_id).toBe(proposal.proposal_id);
  await expect(review.propose(create('different.md'))).rejects.toThrow(/request_id/);
  expect((await new NativeReview().read(proposal.proposal_id)).fileOperation).toMatchObject({ kind: 'create', content: '# New\n' });
  expect(applyFileInWorkspace).not.toHaveBeenCalled();
});
it('accepts an empty new note using the exclusive native writer and rejects duplicate decisions', async () => {
  const p = await review.propose(create('empty.md', ''));
  expect(await review.decide(p.proposal_id, 'local', 'accepted')).toMatchObject({ status: 'completed', operation: { status: 'accepted' }, applied_steps: 1 });
  expect(await read('empty.md')).toBe('');
  await expect(review.decide(p.proposal_id, 'local', 'accepted')).rejects.toThrow(/已经处理/);
});
it('rejects file candidates without creating or renaming notes', async () => {
  const p = await review.propose(await rename());
  expect(await review.decide(p.proposal_id, 'local', 'rejected')).toMatchObject({ status: 'completed', operation: { status: 'rejected' } });
  expect(await read('original.md')).toBe(raw);
  expect(applyFileInWorkspace).not.toHaveBeenCalled();
});
it('renames via the existing Vault owner and preserves raw BOM/mixed endings and content', async () => {
  const p = await review.propose(await rename('folder/重命名.md'));
  expect(await read('original.md')).toBe(raw);
  await review.decide(p.proposal_id, 'local', 'accepted');
  expect(await read('folder/重命名.md')).toBe(raw);
  await expect(read('original.md')).rejects.toMatchObject({ code: 'ENOENT' });
  expect((await review.status(p.proposal_id)).operation).toMatchObject({ kind: 'rename', status: 'accepted' });
});
it('supports case-only note renames and confirms actual filename spelling', async () => {
  const p = await review.propose(await rename('Original.md'));
  await review.decide(p.proposal_id, 'local', 'accepted');
  expect(await fs.readdir(state.root)).toContain('Original.md');
  expect(await fs.readdir(state.root)).not.toContain('original.md');
  expect(await read('Original.md')).toBe(raw);
});
it.each(['renamed.md', 'Original.md'])('recovers a completed rename to %s after a lost acknowledgement and restart', async to => {
  vi.mocked(applyFileInWorkspace).mockImplementationOnce(async (_id, op) => {
    if (op.kind !== 'rename') throw new Error('fixture');
    await vault.rename(op.path, op.to, op.base_revision);
    throw new Error('lost acknowledgement');
  });
  const p = await review.propose(await rename(to));
  expect(await review.decide(p.proposal_id, 'local', 'accepted')).toMatchObject({ status: 'completed', operation: { status: 'accepted' } });
  expect(await new NativeReview().status(p.proposal_id)).toMatchObject({ status: 'completed', applied_steps: 1 });
  const files = await fs.readdir(state.root);
  expect(files).toContain(to); expect(files).not.toContain('original.md');
  expect(await read(to)).toBe(raw);
});
it('keeps an unchanged case-only rename retryable after interruption', async () => {
  vi.mocked(applyFileInWorkspace).mockRejectedValueOnce(new Error('disconnected'));
  const p = await review.propose(await rename('Original.md'));
  await expect(review.decide(p.proposal_id, 'local', 'accepted')).rejects.toThrow('disconnected');
  const restarted = new NativeReview();
  expect(await restarted.status(p.proposal_id)).toMatchObject({ operation: { status: 'pending' } });
  expect(await restarted.decide(p.proposal_id, 'local', 'accepted')).toMatchObject({ operation: { status: 'accepted' } });
  expect(await read('Original.md')).toBe(raw);
});
it('blocks existing create/rename targets and non-note/hidden/traversal paths', async () => {
  await expect(review.propose(create('original.md'))).rejects.toThrow(/已存在/);
  await expect(review.propose(await rename('original.md'))).rejects.toThrow(/相同/);
  await fs.mkdir(path.join(state.root, 'directory.md'));
  await expect(review.propose(await rename('directory.md'))).rejects.toThrow(/已存在/);
  for (const file of ['../escape.md', '.obsidian/config.md', 'a.txt', '/root.md', 'bad?/x.md'])
    await expect(review.propose(create(file))).rejects.toThrow();
});
it('rechecks collisions at acceptance without overwriting any file', async () => {
  const p = await review.propose(create('new.md'));
  await fs.writeFile(path.join(state.root, 'new.md'), 'other');
  await expect(review.decide(p.proposal_id, 'local', 'accepted')).rejects.toThrow(/已存在/);
  expect(await read('new.md')).toBe('other');
  expect(applyFileInWorkspace).not.toHaveBeenCalled();
});
it('requires a fresh source revision for proposal and acceptance', async () => {
  const request = await rename();
  await fs.writeFile(path.join(state.root, 'original.md'), 'external');
  await expect(review.propose(request)).rejects.toThrow(/版本已变化/);
  const p = await review.propose(await rename());
  await fs.writeFile(path.join(state.root, 'original.md'), 'later');
  await expect(review.decide(p.proposal_id, 'local', 'accepted')).rejects.toThrow(/已改变/);
  expect(await read('original.md')).toBe('later');
});
it('blocks dirty source, stale workspace, opened target and disconnected reviewer', async () => {
  const request = await rename();
  state.captures[0].document = { path: 'original.md', raw, revision: request.operations[0].kind === 'rename' ? request.operations[0].base_revision : '', dirty: true };
  await expect(review.propose(request)).rejects.toThrow(/保存源笔记/);
  state.captures[0].document = null;
  const p = await review.propose(request);
  state.captures[0].stale = true;
  await expect(review.decide(p.proposal_id, 'local', 'accepted')).rejects.toThrow(/当前 Vault/);
  state.captures[0].stale = false; state.captures[0].document = { path: 'renamed.md' };
  await expect(review.decide(p.proposal_id, 'local', 'accepted')).rejects.toThrow(/目标路径/);
  state.captures = [];
  await expect(review.decide(p.proposal_id, 'local', 'accepted')).rejects.toThrow(/工作区/);
  expect(applyFileInWorkspace).not.toHaveBeenCalled();
});
it('confirms a completed write after a lost acknowledgement, including after restart', async () => {
  vi.mocked(applyFileInWorkspace).mockImplementationOnce(async (_id, op) => {
    if (op.kind !== 'create') throw new Error('fixture');
    await vault.writeFileText(op.path, op.content, undefined, { createOnly: true });
    throw new Error('lost acknowledgement');
  });
  const p = await review.propose(create());
  expect(await review.decide(p.proposal_id, 'local', 'accepted')).toMatchObject({ operation: { status: 'accepted' } });
  expect(await new NativeReview().status(p.proposal_id)).toMatchObject({ applied_steps: 1 });
});
it('retains ambiguous interrupted rename state across restart and blocks another decision', async () => {
  vi.mocked(applyFileInWorkspace).mockImplementationOnce(async () => {
    await fs.writeFile(path.join(state.root, 'renamed.md'), 'unexpected external content');
    throw new Error('interrupted');
  });
  const p = await review.propose(await rename());
  await expect(review.decide(p.proposal_id, 'local', 'accepted')).rejects.toThrow(/interrupted/);
  const restarted = new NativeReview();
  expect(await restarted.status(p.proposal_id)).toMatchObject({ status: 'recovery_required' });
  await expect(restarted.decide(p.proposal_id, 'local', 'rejected')).rejects.toThrow(/核对|无法确认/);
  expect(await read('original.md')).toBe(raw);
  expect(await read('renamed.md')).toBe('unexpected external content');
});
it('keeps unchanged failed operations retryable and disallows text-hunk/recovery commands on file proposals', async () => {
  vi.mocked(applyFileInWorkspace).mockRejectedValueOnce(new Error('disconnected'));
  const p = await review.propose(create());
  await expect(review.decide(p.proposal_id, 'local', 'accepted')).rejects.toThrow(/disconnected/);
  await expect(review.decide(p.proposal_id, 'local', 'accepted', 'h1')).rejects.toThrow(/整项/);
  await expect(review.decide(p.proposal_id, 'local', 'accepted', undefined, true)).rejects.toThrow(/整项/);
  expect(await review.decide(p.proposal_id, 'local', 'accepted')).toMatchObject({ operation: { status: 'accepted' } });
});
it('keeps the existing text edit and session-save path compatible', async () => {
  const before = await readFileSnapshot('original.md');
  state.captures[0].document = { path: 'original.md', raw, revision: before.revision, dirty: false, version: 1 };
  vi.mocked(applyInWorkspace).mockImplementationOnce(async (_id, _expected, next) => { await vault.writeFileText('original.md', next, before.revision); });
  const p = await review.propose(input({ kind: 'edit', path: 'original.md', base_revision: before.revision,
    edits: [{ from: { line: 1, ch: 2 }, to: { line: 1, ch: 10 }, expected_text: 'Original', replacement: 'Edited' }] }));
  await review.decide(p.proposal_id, 'local', 'accepted');
  expect(await read('original.md')).toBe(raw.replace('Original', 'Edited'));
  expect(applyFileInWorkspace).not.toHaveBeenCalled();
});

it('rejects new duplicate, misplaced or Vault-used typed IDs and warns about unresolved new references', () => {
  replaceCatalog(new VaultCatalog());
  catalog.putNote('other.md', parseNote('other.md', '$$\nE = mc^2\n$$ ^eq-mass-energy\n'));
  const formula = (id: string) => `$$\na^2 + b^2 = c^2\n$$ ^${id}\n`;
  expect(checkContentIds('note.md', '', formula('eq-pythagoras') + '\n由 [[^eq-pythagoras]] 和 ![[^eq-mass-energy]] 可得\n')).toEqual([]);
  expect(() => checkContentIds('note.md', '', formula('eq-mass-energy'))).toThrow(/eq-mass-energy 已在 other\.md/);
  expect(() => checkContentIds('note.md', '', formula('eq-same') + '\n' + formula('eq-same'))).toThrow(/Duplicate content target ID/);
  expect(() => checkContentIds('note.md', '', 'plain text ^eq-loose\n')).toThrow(/does not match a structural target/);
  expect(checkContentIds('note.md', '', '见 [[^eq-guess]]\n')).toEqual([expect.stringMatching(/\[\[\^eq-guess\]\] 找不到目标/)]);
  // Problems already present in the baseline and IDs the note already owns do not block other edits.
  const broken = 'plain text ^eq-loose\n' + formula('eq-own');
  catalog.putNote('note.md', parseNote('note.md', broken));
  expect(checkContentIds('note.md', broken, broken + '\nmore [[^eq-own]]\n')).toEqual([]);
  replaceCatalog(new VaultCatalog());
});
it('returns content ID warnings with a create proposal and stores nothing when IDs are rejected', async () => {
  replaceCatalog(new VaultCatalog());
  catalog.putNote('other.md', parseNote('other.md', '$$\nx\n$$ ^eq-taken\n'));
  await expect(review.propose(create('dup.md', '$$\ny\n$$ ^eq-taken\n'))).rejects.toThrow(/内容引用 ID 无效/);
  expect(await review.propose(create('ok.md', '[[^eq-unknown]]\n'))).toMatchObject({ status: 'awaiting_user_review', warnings: [expect.stringMatching(/eq-unknown/)] });
  expect((await review.propose(input({ kind: 'create', path: 'dup.md', content: '$$\ny\n$$ ^eq-free\n' }, 'second'))).warnings).toBeUndefined();
  replaceCatalog(new VaultCatalog());
});
