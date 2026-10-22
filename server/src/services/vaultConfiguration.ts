import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parse, printParseErrorCode, type ParseError } from 'jsonc-parser';
import { getVaultRoot } from './vault.js';
import { readTextFile, writeTextFile } from './textFile.js';

const DIRECTORY = '.obsidian/webobsidian';
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
async function location(file: string, expectedVault?: string, extensions: readonly string[] = ['.jsonc']) {
  if (!file || file.length > 240 || !extensions.includes(path.extname(file).toLowerCase()) || file.includes('\\') || file.startsWith('/') ||
      file.split('/').some(part => !/^[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/.test(part) || part.endsWith('.') ||
      /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))) throw failure('Invalid configuration path');
  const root = await getVaultRoot();
  const vault = createHash('sha256').update(process.platform === 'win32' ? root.toLowerCase() : root).digest('base64url');
  if (expectedVault !== undefined && expectedVault !== vault) throw failure('Vault changed; reopen configuration', 409);
  const segments = [...DIRECTORY.split('/'), ...file.split('/')];
  let probe = root;
  for (const segment of segments) {
    probe = path.join(probe, segment);
    try { if ((await fs.lstat(probe)).isSymbolicLink()) throw failure('Configuration may not use symbolic links'); }
    catch (error: any) { if (error.code !== 'ENOENT') throw error; }
  }
  return { absolute: path.join(root, ...segments), vault, root };
}
async function assertCurrent(root: string) {
  if (await getVaultRoot() !== root) throw failure('Vault changed during configuration operation', 409);
}
export async function readVaultConfiguration(file: string, vault?: string, extensions?: readonly string[]): Promise<VaultConfigurationSource> {
  const target = await location(file, vault, extensions);
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
export async function writeVaultConfiguration(input: VaultConfigurationSource): Promise<VaultConfigurationSource> {
  const target = await location(input.path, input.vault);
  if (Buffer.byteLength(input.content, 'utf8') > MAX_BYTES) throw failure('Configuration exceeds 1 MiB', 413);
  if (input.exists && !input.revision) throw failure('A revision is required for existing configuration', 409);
  await assertCurrent(target.root);
  await writeTextFile(target.absolute, input.content, input.exists ? input.revision : undefined, !input.exists);
  await assertCurrent(target.root);
  return readVaultConfiguration(input.path, input.vault);
}
