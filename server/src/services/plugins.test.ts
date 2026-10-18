import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const state = vi.hoisted(() => ({
  root: '',
  settings: { plugins: { enabled: ['legacy'], installed: [] as string[] } },
}));
vi.mock('./settings.js', () => ({
  getSettings: async () => state.settings,
  updateSettings: async (fn: any) => fn(state.settings),
}));
vi.mock('./vault.js', () => ({
  getVaultRoot: async () => state.root,
  resolveInVault: async (rel: string) => {
    const absolute = path.resolve(state.root, rel);
    if (absolute !== state.root && !absolute.startsWith(state.root + path.sep))
      throw new Error('Path escapes vault');
    return absolute;
  },
}));
import {
  listInstalled,
  readPluginData,
  writePluginData,
  setEnabled,
  adapterOperation,
} from './plugins.js';
beforeEach(async () => {
  const base = path.join(os.tmpdir(), '.agents');
  await fs.mkdir(base, { recursive: true });
  state.root = await fs.mkdtemp(path.join(base, 'meta-obsidian-plugin-unit-'));
  await fs.mkdir(path.join(state.root, '.obsidian/plugins/test'), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(state.root, '.obsidian/plugins/test/manifest.json'),
    JSON.stringify({ id: 'test', name: 'Test', version: '1' })
  );
});
afterEach(async () => {
  await fs.rm(state.root, { recursive: true, force: true });
});
test('reads existing Obsidian enablement and preserves unknown IDs when toggling', async () => {
  const enabled = path.join(state.root, '.obsidian/community-plugins.json'),
    source = '["test", "missing-original-plugin"]\n';
  await fs.writeFile(enabled, source);
  expect((await listInstalled())[0].enabled).toBe(true);
  expect(await fs.readFile(enabled, 'utf8')).toBe(source);
  await setEnabled('test', false);
  expect(JSON.parse(await fs.readFile(enabled, 'utf8'))).toEqual([
    'missing-original-plugin',
  ]);
  await setEnabled('test', true);
  expect(JSON.parse(await fs.readFile(enabled, 'utf8'))).toEqual([
    'missing-original-plugin',
    'test',
  ]);
});
test('plugin JSON persists across reads, serializes writes, and reports corruption', async () => {
  expect(await readPluginData('test')).toBe(null);
  await Promise.all([
    writePluginData('test', { value: 1 }),
    writePluginData('test', { value: 2 }),
  ]);
  expect(await readPluginData('test')).toEqual({ value: 2 });
  await fs.writeFile(
    path.join(state.root, '.obsidian/plugins/test/data.json'),
    'invalid'
  );
  await expect(readPluginData('test')).rejects.toThrow();
  await expect(writePluginData('../escape', {})).rejects.toThrow(
    'Invalid plugin id'
  );
});
test('vault adapter reads hidden files and binary data and rejects traversal', async () => {
  await adapterOperation('write', '.obsidian/test.txt', { content: 'text' });
  expect(await adapterOperation('read', '.obsidian/test.txt')).toEqual({
    content: 'text',
  });
  await adapterOperation('writeBinary', 'binary.bin', { base64: 'AAH/' });
  expect(await adapterOperation('readBinary', 'binary.bin')).toEqual({
    base64: 'AAH/',
  });
  for (const bad of [
    '../escape',
    'C:/escape',
    '/escape',
    'folder/../../escape',
  ])
    await expect(adapterOperation('read', bad)).rejects.toThrow();
  expect(
    ((await adapterOperation('stat', '.obsidian/test.txt')) as any).stat.type
  ).toBe('file');
});
