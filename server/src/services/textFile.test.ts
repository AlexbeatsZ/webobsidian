import { afterEach, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readTextFile, writeTextFile } from './textFile.js';

const folders: string[] = [];
afterEach(async () => { for (const folder of folders.splice(0)) await fs.rm(folder, { recursive: true, force: true }); });

it('rejects a stale save and preserves exact UTF-8 bytes', async () => {
  const base = path.join(os.tmpdir(), '.agents');
  await fs.mkdir(base, { recursive: true });
  const folder = await fs.mkdtemp(path.join(base, 'rendering-'));
  folders.push(folder);
  const file = path.join(folder, 'note.md');
  const original = '\ufeffa\r\nb\nc';
  await fs.writeFile(file, original);
  const snapshot = await readTextFile(file);
  expect(snapshot.content).toBe(original);
  await writeTextFile(file, 'remote', snapshot.revision);
  await expect(writeTextFile(file, 'local', snapshot.revision)).rejects.toMatchObject({ status: 409 });
  expect(await fs.readFile(file, 'utf8')).toBe('remote');
});
