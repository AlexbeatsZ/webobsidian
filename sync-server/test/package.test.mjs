import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdir, mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';

const root = fileURLToPath(new URL('..', import.meta.url));
const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const output = path.resolve(process.env.WEBOBSIDIAN_SYNC_PACKAGE_DIR ?? path.join(root, 'release', metadata.version));

for (const extension of ['zip', 'tar.gz']) {
  test(`extracted ${extension} runs outside checkout with bundled core and no installation`, async t => {
    const parent = path.join(os.tmpdir(), '.agents'); await mkdir(parent, { recursive: true });
    const temporary = await mkdtemp(path.join(parent, 'webobsidian-extracted-server-'));
    const folder = `webobsidian-sync-server-${metadata.version}`;
    let child;
    let restarted;
    t.after(async () => {
      if (child && child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit'); child.kill(); await exited;
      }
      await restarted?.close();
      if (path.dirname(temporary) !== parent || !path.basename(temporary).startsWith('webobsidian-extracted-server-')) throw new Error('Unsafe extraction fixture');
      await rm(temporary, { recursive: true, force: true, maxRetries: 3 });
    });
    if (extension === 'zip' && process.platform !== 'win32') {
      execFileSync('unzip', ['-q', path.join(output, folder + '.zip'), '-d', temporary]);
    } else {
      execFileSync('tar', ['-xf', path.join(output, folder + '.' + extension), '-C', temporary]);
    }
    const extracted = path.join(temporary, folder);
    const info = JSON.parse(await readFile(path.join(extracted, 'BUILD-INFO.json'), 'utf8'));
    assert.equal(info.version, metadata.version);
    assert.equal(info.requiresInstall, false);
    const coreRoot = path.join(extracted, 'sync-server/node_modules/@alexbeatsz/file-sync-core');
    assert.equal(JSON.parse(await readFile(path.join(coreRoot, 'package.json'), 'utf8')).version, info.core.version);
    await readFile(path.join(coreRoot, 'LICENSE'));
    await readFile(path.join(coreRoot, 'THIRD_PARTY_NOTICES.md'));
    assert.deepEqual((await readdir(path.join(extracted, 'sync-server/node_modules'))), ['@alexbeatsz']);
    const env = { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' };
    const entry = path.join(extracted, 'sync-server/server.mjs');
    assert.equal(execFileSync(process.execPath, [entry, '--version'], { cwd: temporary, env, encoding: 'utf8' }).trim(), metadata.version);
    // Actual standalone CLI child reads a separate private config and keeps credentials out of logs.
    const token = 'fixture-only-extracted-package-secret-0123456789';
    const config = path.join(temporary, 'private.json');
    await writeFile(config, JSON.stringify({ dataDir: path.join(temporary, 'data'), host: '127.0.0.1', port: 0, token }));
    child = spawn(process.execPath, [entry, config], { cwd: temporary, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let logs = '';
    const ready = new Promise((resolve, reject) => {
      const onData = chunk => {
        logs += chunk;
        const match = logs.match(/listening on (127\.0\.0\.1:\d+\/webobsidian-sync\/v1)/);
        if (match) resolve('http://' + match[1] + '/');
      };
      child.stdout.on('data', onData); child.stderr.on('data', onData);
      child.once('exit', code => reject(new Error(`Standalone child exited ${code}: ${logs}`)));
    });
    const base = await Promise.race([ready, new Promise((_, reject) => {
      const timeout = setTimeout(() => reject(new Error('Standalone startup timeout')), 10000); timeout.unref();
    })]);
    assert.equal(logs.includes(token), false);
    const request = (resource, options = {}) => fetch(base + resource, { ...options, headers: { Authorization: `Bearer ${token}` } });
    const manifest = await (await request('manifest')).json();
    const bytes = Buffer.from([0, 255, 128, 13, 10]);
    const hash = createHash('sha256').update(bytes).digest('hex');
    assert.equal((await request('blobs/' + hash, { method: 'PUT', body: bytes })).status, 200);
    const operation = { workspaceId: manifest.workspaceId, deviceId: randomUUID(), operationId: randomUUID(),
      changes: [{ path: 'isolated.bin', expectedVersion: 0, hash }] };
    const reply = await request('commit', { method: 'POST', body: JSON.stringify(operation) });
    assert.equal(reply.status, 200); assert.equal((await reply.json()).revision, 1);
    assert.deepEqual(Buffer.from(await (await request('blobs/' + hash)).arrayBuffer()), bytes);
    assert.equal((await request('manifest')).status, 200);
    const exited = once(child, 'exit'); child.kill(); await exited;
    // Restart the exported API on the very same data root, preserving the persisted receipt.
    const { createSyncServer } = await import(pathToFileURL(entry).href);
    restarted = await createSyncServer({ root: path.join(temporary, 'data'), token });
    await new Promise(resolve => restarted.server.listen(0, '127.0.0.1', resolve));
    const replay = await fetch(`http://127.0.0.1:${restarted.server.address().port}/webobsidian-sync/v1/commit`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(operation),
    });
    assert.equal(replay.status, 200); assert.equal((await replay.json()).revision, 1);
  });
}
