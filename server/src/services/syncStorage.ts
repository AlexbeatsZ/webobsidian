import { promises as fs, createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';

export async function atomicSyncJson(filename: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.tmp-${randomUUID()}`;
  try {
    const handle = await fs.open(temporary, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temporary, filename);
    if (process.platform !== 'win32') {
      const directory = await fs.open(path.dirname(filename), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    }
  } finally { await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

export const fileSignature = (value: { size: number; mtimeMs: number; ctimeMs: number; ino: number }) =>
  `${value.size}:${value.mtimeMs}:${value.ctimeMs}:${value.ino}`;

export async function stageSyncBlob(source: Readable, directory: string, expected?: string): Promise<string> {
  await fs.mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `${randomUUID()}.tmp`);
  const hash = createHash('sha256'); let bytes = 0;
  try {
    await pipeline(source, new Transform({ transform(chunk, encoding, done) {
      bytes += chunk.length;
      if (bytes > 1024 * 1024 * 1024) { done(new Error('单个同步文件不能超过 1 GiB')); return; }
      hash.update(chunk); done(null, chunk);
    } }), createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
    const result = hash.digest('hex');
    if (expected !== undefined && result !== expected) throw new Error('下载内容与同步版本不一致，未写入笔记');
    const handle = await fs.open(temporary, 'r+');
    try { await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temporary, path.join(directory, result));
    return result;
  } finally { await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

export async function stageLocalFile(filename: string, directory: string, expectedSignature: string): Promise<string> {
  const hash = await stageSyncBlob(createReadStream(filename), directory);
  if (fileSignature(await fs.stat(filename)) !== expectedSignature) throw new Error('文件仍在写入，稍后重试同步');
  return hash;
}

export async function withSyncLock<T>(directory: string, work: () => Promise<T>): Promise<T> {
  await fs.mkdir(directory, { recursive: true });
  const filename = path.join(directory, 'client.lock');
  let handle;
  try { handle = await fs.open(filename, 'wx', 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const owner = Number(await fs.readFile(filename, 'utf8'));
    if (!Number.isSafeInteger(owner) || owner <= 0) throw new Error('同步锁无效，请保留恢复目录并检查');
    try { process.kill(owner, 0); throw new Error('另一个进程正在同步此 Vault'); }
    catch (failure) { if ((failure as NodeJS.ErrnoException).code !== 'ESRCH') throw failure; }
    await fs.unlink(filename); handle = await fs.open(filename, 'wx', 0o600);
  }
  try { await handle.writeFile(String(process.pid)); await handle.sync(); return await work(); }
  finally { await handle.close(); await fs.unlink(filename); }
}
