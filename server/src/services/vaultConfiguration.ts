import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parse, printParseErrorCode, type ParseError } from 'jsonc-parser';
import { getVaultRoot, vaultPathKey } from './vaultFile.js';
import { readTextFile, writeTextFile } from './textFile.js';

const DIRECTORY = '.obsidian/webobsidian';
/** Configuration events bypass the note catalog and file tree. */
export function isVaultConfigurationPath(relative: string): boolean {
  return relative === DIRECTORY || relative.startsWith(DIRECTORY + '/') || relative === '.obsidian/appearance.json' || relative === '.obsidian/types.json'
    || relative === '.obsidian/snippets' || /^\.obsidian\/snippets\/[^/]+\.css$/i.test(relative);
}
const MAX_BYTES = 1024 * 1024;
const failure = (message: string, status = 400) => Object.assign(new Error(message), { status });
export interface VaultConfigurationSource {
  path: string; content: string; exists: boolean; revision?: string; vault: string;
}
export function parseConfiguration(content: string): unknown {
  const errors: ParseError[] = [];
  const value = parse(content.replace(/^\uFEFF/, ''), errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length) {
    const before = content.slice(0, errors[0].offset), line = before.split('\n').length;
    throw failure(`配置第 ${line} 行：${printParseErrorCode(errors[0].error)}`);
  }
  return value;
}
async function location(file: string, expectedVault?: string, extensions: readonly string[] = ['.jsonc'], directory = DIRECTORY) {
  if (!file || file.length > 240 || !extensions.includes(path.extname(file).toLowerCase()) || file.includes('\\') || file.startsWith('/') ||
      file.split('/').some(part => !/^[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/.test(part) || part.endsWith('.') ||
      /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))) throw failure('Invalid configuration path');
  const { root, vault } = await vaultConfigurationIdentity();
  if (expectedVault !== undefined && expectedVault !== vault) throw failure('Vault changed; reopen configuration', 409);
  const segments = [...directory.split('/'), ...file.split('/')];
  let probe = root;
  for (const segment of segments) {
    probe = path.join(probe, segment);
    try { if ((await fs.lstat(probe)).isSymbolicLink()) throw failure('Configuration may not use symbolic links'); }
    catch (error: any) { if (error.code !== 'ENOENT') throw error; }
  }
  return { absolute: path.join(root, ...segments), vault, root };
}
/** Identity shared by scoped preferences and configuration-file operations. */
export async function vaultConfigurationIdentity() {
  const root = await getVaultRoot();
  const key = vaultPathKey(root);
  const vault = createHash('sha256').update(key).digest('base64url');
  return { root, key, vault };
}
async function assertCurrent(root: string) {
  if (vaultPathKey(await getVaultRoot()) !== vaultPathKey(root)) throw failure('Vault changed during configuration operation', 409);
}
export async function readVaultConfiguration(file: string, vault?: string, extensions?: readonly string[]): Promise<VaultConfigurationSource> {
  const target = await location(file, vault, extensions);
  return readConfiguration(file, target);
}
/** Read-only legacy source: same size/symlink/revision/Vault checks, no writer. */
export async function readObsidianConfiguration(file: string): Promise<VaultConfigurationSource> {
  return readConfiguration(file, await location(file, undefined, ['.json'], '.obsidian'));
}
async function readConfiguration(file: string, target: Awaited<ReturnType<typeof location>>): Promise<VaultConfigurationSource> {
  try {
    const stat = await fs.stat(target.absolute);
    if (!stat.isFile() || stat.size > MAX_BYTES) throw failure('Configuration must be a UTF-8 file of at most 1 MiB', 413);
    const result = await readTextFile(target.absolute);
    await assertCurrent(target.root);
    return { path: file, ...result, exists: true, vault: target.vault };
  } catch (error: any) {
    if (error.code !== 'ENOENT') throw error;
    await assertCurrent(target.root);
    return { path: file, content: '', exists: false, vault: target.vault };
  }
}
export async function writeVaultConfiguration(input: VaultConfigurationSource, extensions?: readonly string[]): Promise<VaultConfigurationSource> {
  const target = await location(input.path, input.vault, extensions);
  return writeConfiguration(input, target);
}
/** Only these two interoperable Obsidian files have native writers. */
export async function writeObsidianPropertyTypes(input: VaultConfigurationSource): Promise<VaultConfigurationSource> {
  if (input.path !== 'types.json') throw failure('Invalid property configuration path');
  return writeConfiguration(input, await location(input.path, input.vault, ['.json'], '.obsidian'));
}
export async function writeObsidianAppearance(input: VaultConfigurationSource): Promise<VaultConfigurationSource> {
  if (input.path !== 'appearance.json') throw failure('Invalid appearance configuration path');
  return writeConfiguration(input, await location(input.path, input.vault, ['.json'], '.obsidian'));
}
async function writeConfiguration(input: VaultConfigurationSource, target: Awaited<ReturnType<typeof location>>): Promise<VaultConfigurationSource> {
  if (Buffer.byteLength(input.content, 'utf8') > MAX_BYTES) throw failure('Configuration exceeds 1 MiB', 413);
  if (input.exists && !input.revision) throw failure('A revision is required for existing configuration', 409);
  await assertCurrent(target.root);
  await writeTextFile(target.absolute, input.content, input.exists ? input.revision : undefined, !input.exists);
  await assertCurrent(target.root);
  return readConfiguration(input.path, target);
}
