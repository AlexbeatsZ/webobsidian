import { shell } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';

/** Server settings own the effective Vault; desktop config is only a startup default. */
export async function effectiveVaultPath(dataDir: string, fallback?: string): Promise<string> {
  let vault: unknown = fallback;
  try {
    const settings = JSON.parse(await fs.readFile(path.join(dataDir, 'settings.json'), 'utf8'));
    vault = settings?.vault?.path;
  } catch (error: any) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (typeof vault !== 'string' || !vault.trim() || vault.includes('\0')) throw new Error('未配置有效的笔记库路径');
  return path.resolve(vault);
}

/** Report missing targets and OS open failures instead of silently creating files. */
export async function openExistingPath(target: string): Promise<void> {
  const entry = await fs.stat(target);
  if (!entry.isFile() && !entry.isDirectory()) throw new Error('只能打开文件或目录');
  const error = await shell.openPath(target);
  if (error) throw new Error(error);
}

/** File-manager reveal is scoped to the effective Vault, including symlinks. */
export async function revealVaultItem(dataDir: string, requested: string, fallback?: string): Promise<void> {
  if (typeof requested !== 'string' || requested.length > 32768 || requested.includes('\0') || path.isAbsolute(requested)) throw new Error('文件路径无效');
  const root = await fs.realpath(await effectiveVaultPath(dataDir, fallback));
  const target = await fs.realpath(path.resolve(root, requested.replace(/\\/g, '/')));
  const relative = path.relative(root, target);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('路径必须位于当前笔记库内');
  const entry = await fs.stat(target);
  if (entry.isDirectory()) await openExistingPath(target);
  else if (entry.isFile()) shell.showItemInFolder(target);
  else throw new Error('只能打开文件或目录');
}
