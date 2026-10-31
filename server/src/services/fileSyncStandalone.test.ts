import { it, expect, vi } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { AddressInfo } from 'node:net';
import type { createSyncServer as CreateSyncServer } from '../../../sync-server/server.mjs';
import { FileSyncEngine } from './fileSyncEngine.js';

it('current native client survives a lost receipt, server restart and binary conflict against a standalone server', async () => {
  const parent = path.join(os.tmpdir(), '.agents'); await fs.mkdir(parent, { recursive: true });
  const temporary = await fs.mkdtemp(path.join(parent, 'webobsidian-standalone-client-'));
  const entry = path.resolve(process.env.WEBOBSIDIAN_SYNC_TEST_SERVER ?? 'sync-server/server.mjs');
  const { createSyncServer } = await import(/* @vite-ignore */ pathToFileURL(entry).href) as { createSyncServer: typeof CreateSyncServer };
  const token = 'fixture-only-standalone-client-token-123456789';
  let service = await createSyncServer({ root: path.join(temporary, 'hub'), token });
  try {
    await new Promise<void>(resolve => service.server.listen(0, '127.0.0.1', resolve));
    const port = (service.server.address() as AddressInfo).port;
    const endpoint = `http://127.0.0.1:${port}/webobsidian-sync/v1/`;
    const preferences = { enabled: true, endpoints: [endpoint], token, intervalSec: 3600 };
    const makeClient = async (name: string) => {
      const root = path.join(temporary, name); const state = path.join(temporary, name + '-state');
      await fs.mkdir(root);
      const create = () => new FileSyncEngine(root, state, preferences, { publish: work => work(), changed: async () => {} });
      return { root, state, create, engine: create() };
    };
    const first = await makeClient('first'); const second = await makeClient('second');
    const originalBytes = Buffer.from([0, 255, 128, 137, 80, 78, 71]);
    await fs.writeFile(path.join(first.root, 'image.png'), originalBytes);
    await fs.writeFile(path.join(first.root, '笔记.md'), '# 原始\r\n');
    const originalFetch = globalThis.fetch; const operations: string[] = []; let lost = false;
    const intercepted = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, options) => {
      const response = await originalFetch(input, options);
      if (String(input).endsWith('/commit')) {
        operations.push(JSON.parse(String(options?.body)).operationId);
        if (!lost) { lost = true; await response.text(); throw new TypeError('fixture response lost'); }
      }
      return response;
    });
    expect((await first.engine.run()).phase).toBe('error');
    await service.close();
    const bytesBefore = await fs.readFile(path.join(temporary, 'hub/state.json'));
    service = await createSyncServer({ root: path.join(temporary, 'hub'), token });
    expect(await fs.readFile(path.join(temporary, 'hub/state.json'))).toEqual(bytesBefore);
    await new Promise<void>(resolve => service.server.listen(port, '127.0.0.1', resolve));
    first.engine = first.create();
    expect((await first.engine.run()).phase).toBe('idle');
    expect(operations).toEqual([operations[0], operations[0]]);
    intercepted.mockRestore();
    expect((await second.engine.run()).phase).toBe('idle');
    expect(await fs.readFile(path.join(second.root, 'image.png'))).toEqual(originalBytes);
    expect(await fs.readFile(path.join(second.root, '笔记.md'), 'utf8')).toBe('# 原始\r\n');
    const remote = Buffer.from([2, 254]); const local = Buffer.from([3, 253]);
    await fs.writeFile(path.join(first.root, 'image.png'), remote); first.engine.noteChanged('image.png');
    expect((await first.engine.run()).phase).toBe('idle');
    await fs.writeFile(path.join(second.root, 'image.png'), local); second.engine.noteChanged('image.png');
    const conflict = await second.engine.run(); expect(conflict.phase).toBe('conflict');
    expect(await fs.readFile(path.join(conflict.conflictDirectory!, 'local/image.png'))).toEqual(local);
    expect(await fs.readFile(path.join(conflict.conflictDirectory!, 'remote/image.png'))).toEqual(remote);
    expect((await second.engine.resolveConflict('local')).phase).toBe('idle');
    expect((await first.engine.run()).phase).toBe('idle');
    expect(await fs.readFile(path.join(first.root, 'image.png'))).toEqual(local);
  } finally {
    vi.restoreAllMocks();
    await service.close();
    if (path.dirname(temporary) !== parent || !path.basename(temporary).startsWith('webobsidian-standalone-client-')) throw new Error('Unsafe client fixture');
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 3 });
  }
}, 20000);
