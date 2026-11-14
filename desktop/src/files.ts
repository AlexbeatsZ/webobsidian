import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';

export async function writeJson(filename: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
    await fs.rename(temporary, filename);
  } finally { await fs.rm(temporary, { force: true }); }
}

export async function createLogStream(filename: string): Promise<Writable> {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const limit = 4 * 1024 * 1024;
  let file = await fs.open(filename, 'a');
  let size = (await file.stat()).size;
  return new Writable({
    write(chunk: Buffer, _encoding, callback) {
      void (async () => {
        const bytes = chunk.subarray(Math.max(0, chunk.length - limit));
        if (size + bytes.length > limit) {
          await file.close();
          await fs.rm(`${filename}.1`, { force: true });
          await fs.rename(filename, `${filename}.1`);
          file = await fs.open(filename, 'a');
          size = 0;
        }
        await file.writeFile(bytes);
        size += bytes.length;
      })().then(() => callback(), callback);
    },
    final(callback) { void file.close().then(() => callback(), callback); },
    destroy(error, callback) { void file.close().then(() => callback(error), () => callback(error)); },
  });
}
