import { catalog } from './catalog.js';
export const resolveIndexedTarget = (target: string, sourcePath = '') => catalog.resolve(target, sourcePath);
export function resolveFile(target: string, sourcePath = '') {
  const r = resolveIndexedTarget(target, sourcePath);
  return r.status === 'resolved' ? r.path : undefined;
}
export const indexFile = (path: string) => catalog.putPath(path);
export const unindexFile = (path: string) => catalog.remove(path);
export const hasIndexedFile = (path: string) => catalog.targets.has(path);
export const indexedFilesUnder = (path: string) =>
  [...catalog.targets.paths()].filter((p) => p === path || p.startsWith(path + '/'));
export async function buildFileIndex() {
  const { rebuildVaultIndex } = await import('./vaultindex.js');
  await rebuildVaultIndex();
}
