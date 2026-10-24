import { afterEach, beforeEach, expect, test } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DebugLog } from './debugLog';

let root: string;
beforeEach(async () => {
  const base = path.join(os.tmpdir(), '.agents'); await fs.mkdir(base, { recursive: true });
  root = await fs.mkdtemp(path.join(base, 'webobsidian-debug-test-'));
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
test('read and clear leave an absent log directory absent', async () => {
  const log = new DebugLog(path.join(root, 'debug'));
  expect(await log.read()).toBe(''); await log.clear();
  await expect(fs.stat(log.directory)).rejects.toMatchObject({ code: 'ENOENT' });
});
test('concurrent appends preserve complete ordered JSONL records', async () => {
  const log = new DebugLog(root);
  await Promise.all(Array.from({ length: 40 }, (_, sequence) => log.append([{ sequence, text: '正文\n换行' }])));
  expect((await log.read()).trim().split('\n').map(line => JSON.parse(line).sequence)).toEqual(Array.from({ length: 40 }, (_, i) => i));
});
test('rotation retains only four generations and enforces the byte bound', async () => {
  const log = new DebugLog(root, 100, 4);
  for (let i = 0; i < 9; i++) await log.append([{ i, text: 'x'.repeat(65) }]);
  const files = await fs.readdir(root); expect(files).toHaveLength(4);
  for (const file of files) expect((await fs.stat(path.join(root, file))).size).toBeLessThanOrEqual(100);
  expect((await log.read()).trim().split('\n').map(line => JSON.parse(line).i)).toEqual([5, 6, 7, 8]);
});
test('a rejected batch does not poison the serialized writer', async () => {
  const log = new DebugLog(root, 100);
  await expect(log.append([{ text: 'x'.repeat(150) }])).rejects.toMatchObject({ status: 413 });
  await log.append([{ ok: true }]); expect(await log.read()).toBe('{"ok":true}\n');
  await log.clear(); expect(await log.read()).toBe('');
});
