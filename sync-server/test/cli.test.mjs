import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import http from 'node:http';
import { readFile, writeFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runCli } from '../cli.mjs';
import { createSyncServer } from '../server.mjs';
import { fixture, token } from './fixtures.mjs';

test('supports help/version without configuration, secrets or a data directory', () => {
  const entry = fileURLToPath(new URL('../server.mjs', import.meta.url));
  const options = { encoding: 'utf8', env: { ...process.env, WEBOBSIDIAN_SYNC_TOKEN: '' } };
  assert.match(execFileSync(process.execPath, [entry, '--help'], options), /18744/);
  assert.equal(execFileSync(process.execPath, [entry, '--version'], options).trim(), '0.1.0');
});

test('preserves config/env precedence, cwd-relative dataDir and graceful lock release', async t => {
  const data = await fixture(t);
  const config = path.join(data.directory, 'server.json');
  const root = path.join(data.directory, 'relative-data');
  const signalListeners = process.listenerCount('SIGTERM');
  await writeFile(config, JSON.stringify({ dataDir: path.relative(process.cwd(), root), token, port: 0, host: '127.0.0.1' }));
  const service = await runCli(createSyncServer, [config], { WEBOBSIDIAN_SYNC_TOKEN: 'bad', WEBOBSIDIAN_SYNC_PORT: '99999' });
  t.after(() => service.close());
  assert.equal(JSON.parse(await readFile(path.join(root, 'state.json'), 'utf8')).manifest.revision, 0);
  assert.notEqual(service.server.address().port, 0);
  await service.close();
  const restarted = await runCli(createSyncServer, [], { WEBOBSIDIAN_SYNC_DATA: root, WEBOBSIDIAN_SYNC_TOKEN: token,
    WEBOBSIDIAN_SYNC_PORT: '0', WEBOBSIDIAN_SYNC_HOST: '127.0.0.1' });
  t.after(() => restarted.close());
  await restarted.close();
  await assert.rejects(access(path.join(root, 'server.lock')));
  assert.equal(process.listenerCount('SIGTERM'), signalListeners);
});

test('invalid listener configuration and occupied ports do not leave a data-root lock', async t => {
  const data = await fixture(t); const root = path.join(data.directory, 'invalid');
  await assert.rejects(runCli(createSyncServer, [], { WEBOBSIDIAN_SYNC_PORT: '99999', WEBOBSIDIAN_SYNC_DATA: root }), /port/);
  await assert.rejects(access(root));
  const occupied = http.createServer();
  await new Promise(resolve => occupied.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => occupied.close(resolve)));
  await assert.rejects(runCli(createSyncServer, [], { WEBOBSIDIAN_SYNC_DATA: root, WEBOBSIDIAN_SYNC_TOKEN: token,
    WEBOBSIDIAN_SYNC_PORT: String(occupied.address().port) }), { code: 'EADDRINUSE' });
  await assert.rejects(access(path.join(root, 'server.lock')));
});
