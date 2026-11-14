import { expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { finished } from 'node:stream/promises';
import path from 'node:path';
import os from 'node:os';
import { createLogStream, writeJson } from './files';
import { ServerProcess } from './serverProcess';

it('cancels startup when its loading window already requested application quit', async () => {
  const server = new ServerProcess({ executable: process.execPath, entry: 'unreachable', dataDir: 'unreachable',
    logFile: 'unreachable', env: {}, onExit: () => { throw new Error('Cancelled child must never start'); } });
  await server.stop();
  await expect(server.start()).rejects.toThrow('启动已取消');
});

it('writes atomic private JSON and bounds live logs to the current file and one previous file', async () => {
  const parent = process.platform === 'win32' ? path.join(os.tmpdir(), '.agents') : '/tmp/.agents';
  await fs.mkdir(parent, { recursive: true });
  const directory = await fs.mkdtemp(path.join(parent, 'webobsidian-host-files-'));
  try {
    const config = path.join(directory, 'config.json');
    await Promise.all([writeJson(config, { value: 1 }), writeJson(config, { value: 2 })]);
    expect([1, 2]).toContain(JSON.parse(await fs.readFile(config, 'utf8')).value);
    expect((await fs.readdir(directory)).some(name => name.endsWith('.tmp'))).toBe(false);
    const filename = path.join(directory, 'server.log');
    const stream = await createLogStream(filename);
    stream.write(Buffer.alloc(3 * 1024 * 1024, 'a'));
    stream.write(Buffer.alloc(3 * 1024 * 1024, 'b'));
    stream.end('tail');
    await finished(stream);
    expect((await fs.stat(filename)).size).toBe(3 * 1024 * 1024 + 4);
    expect((await fs.stat(`${filename}.1`)).size).toBe(3 * 1024 * 1024);
    expect((await fs.readFile(filename, 'utf8')).endsWith('tail')).toBe(true);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
