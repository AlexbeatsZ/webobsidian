import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { getVaultRoot } from './vault.js';
import { readTextFile, writeTextFile } from './textFile.js';

const DIRECTORY = '.obsidian/webobsidian/menus';
const MAX_BYTES = 1024 * 1024;
const failure = (message: string, status = 400) => Object.assign(new Error(message), { status });

export interface ConfiguredMenuSource {
  path: string;
  content: string;
  exists: boolean;
  revision?: string;
  vault: string;
}

/** This endpoint can address JSONC files only inside the native menu directory. */
function safePath(value: string): string {
  if (!value || value.length > 240 || !/\.jsonc$/i.test(value) || value.includes('\\') || value.startsWith('/')) throw failure('Invalid menu configuration path');
  if (value.split('/').some((part) => !/^[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/.test(part) || part.endsWith('.') || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))) throw failure('Invalid menu configuration path');
  return value;
}

async function location(file: string, expectedVault?: string) {
  const root = await getVaultRoot();
  const vault = createHash('sha256').update(process.platform === 'win32' ? root.toLowerCase() : root).digest('base64url');
  if (expectedVault !== undefined && expectedVault !== vault) throw failure('Vault changed; reload menu configuration', 409);
  const clean = safePath(file);
  const segments = [...DIRECTORY.split('/'), ...clean.split('/')];
  let probe = root;
  // Reject junctions/symlinks even when their target stays elsewhere in this Vault.
  for (const segment of segments) {
    probe = path.join(probe, segment);
    try {
      const stat = await fs.lstat(probe);
      if (stat.isSymbolicLink()) throw failure('Menu configuration may not use symbolic links');
    } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
  }
  return { absolute: path.join(root, ...segments), vault, root, clean };
}

async function assertCurrent(root: string) {
  if (await getVaultRoot() !== root) throw failure('Vault changed during menu configuration operation', 409);
}

export async function readConfiguredMenu(file = 'menu.jsonc', expectedVault?: string): Promise<ConfiguredMenuSource> {
  const target = await location(file, expectedVault);
  try {
    const stat = await fs.stat(target.absolute);
    if (!stat.isFile() || stat.size > MAX_BYTES) throw failure('Menu configuration must be a UTF-8 file of at most 1 MiB', 413);
    const result = await readTextFile(target.absolute);
    await assertCurrent(target.root);
    return { path: target.clean, ...result, exists: true, vault: target.vault };
  } catch (error: any) {
    if (error.code !== 'ENOENT') throw error;
    await assertCurrent(target.root);
    return { path: target.clean, content: '', exists: false, vault: target.vault };
  }
}

export async function writeConfiguredMenu(input: { path: string; content: string; vault: string; exists: boolean; revision?: string }): Promise<ConfiguredMenuSource> {
  const target = await location(input.path, input.vault);
  if (Buffer.byteLength(input.content, 'utf8') > MAX_BYTES) throw failure('Menu configuration exceeds 1 MiB', 413);
  await assertCurrent(target.root);
  if (input.exists) {
    if (!input.revision) throw failure('A base revision is required for existing menu files', 409);
    // Reuse the application's serialized, conflict-aware atomic text writer.
    await writeTextFile(target.absolute, input.content, input.revision);
  } else {
    await fs.mkdir(path.dirname(target.absolute), { recursive: true });
    // Exclusive creation ensures that an example never overwrites a file created
    // in an external editor after Settings loaded its missing-file snapshot.
    let handle;
    try { handle = await fs.open(target.absolute, 'wx'); }
    catch (error: any) { if (error.code === 'EEXIST') throw failure('Menu configuration was created externally; reload first', 409); throw error; }
    try { await handle.writeFile(input.content, 'utf8'); }
    finally { await handle.close(); }
  }
  await assertCurrent(target.root);
  return readConfiguredMenu(input.path, input.vault);
}
