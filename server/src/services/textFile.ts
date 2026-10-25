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
  const bytes = Buffer.from(content, 'utf8');
  await writeBytes(absolutePath, bytes, baseRevision, createOnly);
  return { revision: revisionOf(bytes) };
}

export async function writeBinaryFile(absolutePath: string, bytes: Buffer): Promise<void> {
  await writeBytes(absolutePath, bytes, undefined, false, false);
}

async function writeBytes(absolutePath: string, bytes: Buffer, baseRevision?: string, createOnly = false, compareExisting = true): Promise<void> {
  absolutePath = path.resolve(absolutePath);
  const key = process.platform === 'win32' ? absolutePath.toLowerCase() : absolutePath;
  const previous = queues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.catch(() => {}).then(() => gate);
  queues.set(key, queued);
  await previous.catch(() => {});
  try {
    const existing = !createOnly && compareExisting ? await fs.readFile(absolutePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    }) : null;
    if (baseRevision !== undefined && (!existing || revisionOf(existing) !== baseRevision)) {
      throw Object.assign(new Error('File changed outside this session; local edits were preserved'), { status: 409 });
    }
    if (existing?.equals(bytes)) return;
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    const temporary = `${absolutePath}.tmp-${randomUUID()}`;
    try {
      await fs.writeFile(temporary, bytes);
      if (createOnly) {
        try { await fs.link(temporary, absolutePath); }
        catch (error: any) { if (error.code === 'EEXIST') throw Object.assign(new Error('File already exists; existing content preserved'), { status: 409 }); throw error; }
      } else await fs.rename(temporary, absolutePath);
    } finally { await fs.unlink(temporary).catch(() => {}); }
  } finally {
    release();
    if (queues.get(key) === queued) queues.delete(key);
  }
}
