import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { McpContextQueue } from './mcpContext.js';

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true }); });
async function fixture() {
  const parent = path.join(os.tmpdir(), '.agents'); await fs.mkdir(parent, { recursive: true });
  const directory = await fs.mkdtemp(path.join(parent, 'mcp-context-')); directories.push(directory);
  let root = 'fixture-vault';
  const changed = vi.fn(), queue = new McpContextQueue(directory, async () => root, changed);
  const vault = (await queue.list()).vault;
  return { queue, directory, vault, changed, switchVault: () => { root = 'other-vault'; } };
}

describe('explicit MCP context queue', () => {
  it('persists path-only pages without expanding note contents', async () => {
    const { queue, vault, directory } = await fixture();
    const result = await queue.add({ kind: 'page', path: 'a.md' }, vault);
    expect(result.items[0]).toMatchObject({ path: 'a.md', kind: 'page', pinned: false });
    expect(result.items[0]).not.toHaveProperty('selections');
    const restored = new McpContextQueue(directory, async () => 'fixture-vault', () => {});
    expect(await restored.list()).toEqual(result);
  });
  it('keeps captured coordinates/revision and pinned items after delivery', async () => {
    const { queue, vault } = await fixture();
    const result = await queue.add({ kind: 'selection', path: 'a.md', revision: 'captured', selections: [
      { kind: 'source', text: 'selected', from: { line: 2, ch: 3 }, to: { line: 2, ch: 11 } },
    ] }, vault);
    await queue.change(result.items[0].id, true);
    await queue.consume(vault, result.items);
    expect((await queue.list()).items[0]).toMatchObject({ pinned: true, revision: 'captured', selections: result.items[0].selections });
  });
  it('only removes IDs actually delivered and never items added in flight', async () => {
    const { queue, vault } = await fixture();
    const delivered = await queue.add({ kind: 'page', path: 'a.md' }, vault);
    await queue.add({ kind: 'page', path: 'b.md' }, vault);
    await queue.consume(vault, delivered.items);
    expect((await queue.list()).items.map(item => item.path)).toEqual(['b.md']);
  });
  it('does not consume a previously pinned snapshot after it is unpinned in flight', async () => {
    const { queue, vault } = await fixture();
    const added = await queue.add({ kind: 'page', path: 'a.md' }, vault);
    const pinned = await queue.change(added.items[0].id, true);
    await queue.change(added.items[0].id, false);
    await queue.consume(vault, pinned.items);
    expect((await queue.list()).items).toHaveLength(1);
  });
  it('isolates Vaults and refuses stale additions/consumption', async () => {
    const { queue, vault, switchVault } = await fixture();
    const old = await queue.add({ kind: 'page', path: 'a.md' }, vault);
    switchVault();
    expect((await queue.list()).items).toEqual([]);
    await expect(queue.add({ kind: 'page', path: 'b.md' }, vault)).rejects.toThrow('Vault');
    await queue.consume(vault, old.items);
    expect((await queue.list()).items).toEqual([]);
  });
  it('serializes concurrent mutations without losing items and supports explicit removal', async () => {
    const { queue, vault } = await fixture();
    await Promise.all(Array.from({ length: 10 }, (_, index) => queue.add({ kind: 'page', path: `${index}.md` }, vault)));
    const first = (await queue.list()).items[0]; await queue.change(first.id);
    expect((await queue.list()).items).toHaveLength(9);
    await expect(queue.change(first.id, true)).rejects.toThrow('已移除');
  });
  it('bounds storage, preserves pending context on failure and recovers the mutation chain', async () => {
    const { queue, vault } = await fixture();
    await queue.add({ kind: 'page', path: 'safe.md' }, vault);
    const selections = Array.from({ length: 20 }, () => ({ kind: 'rendered' as const, text: 'x'.repeat(16384) }));
    await queue.add({ kind: 'selection', path: 'large.md', selections }, vault);
    await expect(queue.add({ kind: 'selection', path: 'overflow.md', selections }, vault)).rejects.toThrow('已满');
    expect((await queue.list()).items.map(item => item.path)).toEqual(['safe.md', 'large.md']);
    await queue.add({ kind: 'page', path: 'later.md' }, vault);
    expect((await queue.list()).items).toHaveLength(3);
  });
  it('serializes deliveries and preserves the queue when a delivery fails', async () => {
    const { queue, vault } = await fixture();
    await queue.add({ kind: 'page', path: 'a.md' }, vault);
    await expect(queue.deliver(async () => { throw new Error('connection lost'); })).rejects.toThrow('connection lost');
    const delivered: string[][] = [];
    const deliver = () => queue.deliver(async () => {
      const current = await queue.list(); delivered.push(current.items.map(item => item.path));
      await queue.consume(current.vault, current.items);
    });
    await Promise.all([deliver(), deliver()]);
    expect(delivered).toEqual([['a.md'], []]);
  });
});
