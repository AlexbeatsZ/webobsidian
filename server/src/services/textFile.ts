import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

/** Content revisions are concurrency tokens, not file integrity audits. */
const revisionOf = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('base64url');
const queues = new Map<string, Promise<void>>();

export async function readTextFile(absolutePath: string): Promise<{ content: string; revision: string }> {
  const bytes = await fs.readFile(absolutePath);
  const content = bytes.toString('utf8');
  if (!Buffer.from(content, 'utf8').equals(bytes)) {
    throw Object.assign(new Error('File is not lossless UTF-8; editing is disabled'), { status: 415 });
  }
  return { content, revision: revisionOf(bytes) };
}

export async function writeTextFile(absolutePath: string, content: string, baseRevision?: string, createOnly = false): Promise<{ revision: string }> {
  const key = process.platform === 'win32' ? absolutePath.toLowerCase() : absolutePath;
  const previous = queues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.catch(() => {}).then(() => gate);
  queues.set(key, queued);
  await previous.catch(() => {});
  try {
    if (createOnly) {
      const bytes = Buffer.from(content, 'utf8');
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      try { await fs.writeFile(absolutePath, bytes, { flag: 'wx' }); }
      catch (error: any) { if (error.code === 'EEXIST') throw Object.assign(new Error('File already exists; existing content preserved'), { status: 409 }); throw error; }
      return { revision: revisionOf(bytes) };
    }
    const existing = await fs.readFile(absolutePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (baseRevision !== undefined && (!existing || revisionOf(existing) !== baseRevision)) {
      throw Object.assign(new Error('File changed outside this session; local edits were preserved'), { status: 409 });
    }
    const bytes = Buffer.from(content, 'utf8');
    if (existing?.equals(bytes)) return { revision: revisionOf(bytes) };
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    const temporary = `${absolutePath}.tmp-${randomUUID()}`;
    try {
      await fs.writeFile(temporary, bytes);
      await fs.rename(temporary, absolutePath);
    } finally { await fs.unlink(temporary).catch(() => {}); }
    return { revision: revisionOf(bytes) };
  } finally {
    release();
    if (queues.get(key) === queued) queues.delete(key);
  }
}
