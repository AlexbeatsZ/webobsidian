import { promises as fs } from 'node:fs';
import path from 'node:path';
import { TargetIndex } from '@webobsidian/markdown-core';
import { getVaultRoot, toRel } from './vault.js';

const IGNORED = new Set(['.git', 'node_modules']);
let files = new TargetIndex();

export async function buildFileIndex(): Promise<void> {
  const root = await getVaultRoot();
  const next = new Set<string>();
  async function walk(directory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (IGNORED.has(entry.name) || entry.name.startsWith('.')) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) next.add(toRel(root, absolute));
    }
  }
  await walk(root);
  files = new TargetIndex(next);
}

export function resolveIndexedTarget(target: string, sourcePath = '') {
  return files.resolve(target, sourcePath);
}
export function resolveFile(target: string, sourcePath = ''): string | undefined {
  const result = resolveIndexedTarget(target, sourcePath);
  return result.status === 'resolved' ? result.path : undefined;
}
export function indexFile(relative: string): void { files.add(relative); }
export function unindexFile(relative: string): void { files.delete(relative); }
