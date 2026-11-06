import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
vi.mock('electron', () => ({ shell: { openPath: vi.fn(async () => ''), showItemInFolder: vi.fn() } }));
import { shell } from 'electron';
import { revealVaultItem } from './paths';
let root = '';
beforeEach(async () => {
  const parent = path.join(process.platform === 'win32' ? os.tmpdir() : '/tmp', '.agents');
  await fs.mkdir(parent, { recursive: true });root = await fs.mkdtemp(path.join(parent, 'reveal-vault-'));
  await fs.mkdir(root + '/data'); await fs.mkdir(root + '/vault/Book', { recursive: true });
  await fs.writeFile(root + '/vault/Book/chapter.md', 'kept');
  await fs.writeFile(root + '/data/settings.json', JSON.stringify({ vault: { path: root + '/vault' } }));
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
it('opens an existing folder and reveals a file using the effective Vault', async () => {
  const real = await fs.realpath(root + '/vault');
  await revealVaultItem(root + '/data', 'Book');expect(shell.openPath).toHaveBeenCalledWith(path.join(real, 'Book'));
  await revealVaultItem(root + '/data', 'Book/chapter.md');expect(shell.showItemInFolder).toHaveBeenCalledWith(path.join(real, 'Book', 'chapter.md'));
});
it('rejects absolute, missing and symlink/traversal targets outside the Vault', async () => {
  await fs.writeFile(path.join(root, 'secret.md'), 'outside');await fs.symlink(path.join(root, 'secret.md'), root + '/vault/link.md');
  for (const target of [path.join(root, 'secret.md'), '../secret.md', 'link.md', 'missing.md'])
    await expect(revealVaultItem(root + '/data', target)).rejects.toThrow();
  expect(shell.showItemInFolder).not.toHaveBeenCalled();expect(shell.openPath).not.toHaveBeenCalled();
});
