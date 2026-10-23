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
