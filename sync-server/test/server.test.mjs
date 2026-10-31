import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import http from 'node:http';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createSyncServer } from '../server.mjs';
import { validPath, validateManifest } from '../protocol.mjs';
import { addFileSyncRoute } from '../shared-gateway.mjs';
import { routeWebObsidian } from '../gateway-route.mjs';
import { fixture, token, operation, commit, digest } from './fixtures.mjs';

test('retains strict WebObsidian request, token and path policy', async t => {
  const data = await fixture(t);
  for (const value of ['short', 'a'.repeat(513), '空'.repeat(32), 'a'.repeat(32) + '\n']) {
    const root = path.join(data.directory, randomUUID());
    await assert.rejects(createSyncServer({ root, token: value }));
    await assert.rejects(access(root));
  }
  const hub = await data.start();
  assert.equal((await hub.request('manifest', { headers: { Authorization: '' } })).status, 401);
  for (const [resource, headers] of [['manifest?x=1', {}], ['manifest', { Origin: 'https://fixture.invalid' }]]) {
    const reply = await hub.request(resource, { headers });
    assert.equal(reply.status, 400);
    assert.deepEqual(await reply.json(), { error: 'invalid_request' });
  }
  // Fetch strips fragments; send the literal raw target to exercise the server predicate.
  const fragmented = await new Promise((resolve, reject) => {
    const url = new URL(hub.base);
    const request = http.get({ hostname: url.hostname, port: url.port, path: url.pathname + 'manifest#x',
      headers: { Authorization: `Bearer ${token}` } }, response => {
      response.resume(); response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject);
  });
  assert.equal(fragmented, 400);
  assert.equal((await hub.request('../v2/manifest')).status, 404);
  const manifest = await (await hub.request('manifest')).json();
  for (const name of ['../a', '.git/config', '.obsidian/workspace.json', 'A/CON.txt', 'a\\b', 'node_modules/x', 'x.tmp']) {
    assert.equal(validPath(name), false);
    assert.equal((await commit(hub, operation(manifest.workspaceId, [{ path: name, hash: null, expectedVersion: 0 }]))).status, 400);
  }
  for (const name of ['笔记.md', '.obsidian/webobsidian/sync.jsonc', 'Attachments/a.bin']) assert.equal(validPath(name), true);
  assert.throws(() => validateManifest({ ...manifest, revision: 1, files: {
    a: { hash: digest('a'), version: 1 }, 'a/child.md': { hash: digest('b'), version: 1 },
  } }));
});

test('streams exact blobs and keeps batch CAS, tombstones, history and original receipt replay', async t => {
  const data = await fixture(t); const hub = await data.start(undefined, { maxBlobBytes: 1024 });
  const bytes = Buffer.from([137, 80, 78, 71, 0, 255, 128]);
  const hash = digest(bytes);
  assert.equal((await hub.request('blobs/' + hash, { method: 'PUT', body: bytes })).status, 200);
  assert.deepEqual(Buffer.from(await (await hub.request('blobs/' + hash)).arrayBuffer()), bytes);
  assert.equal((await hub.request('blobs/' + digest('other'), { method: 'PUT', body: bytes })).status, 422);
  assert.equal((await hub.request('blobs/' + digest('big'), { method: 'PUT', body: Buffer.alloc(1025) })).status, 413);
  const initial = await (await hub.request('manifest')).json();
  const body = operation(initial.workspaceId, [
    { path: '笔记.md', hash, expectedVersion: 0 },
    { path: '附件/a.png', hash, expectedVersion: 0 },
    { path: 'removed.md', hash: null, expectedVersion: 0 },
  ]);
  const receipt = await (await commit(hub, body)).json();
  assert.equal(receipt.revision, 1);
  assert.deepEqual(await (await commit(hub, { ...body, changes: [...body.changes].reverse() })).json(), receipt);
  assert.deepEqual(await (await commit(hub, { ...body, changes: [{ ...body.changes[0], hash: null }] })).json(), { error: 'operation_reused' });
  const conflict = await commit(hub, { ...body, operationId: randomUUID() });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error, 'version_conflict');
  assert.equal((await commit(hub, operation(initial.workspaceId, [{ path: '附件', hash, expectedVersion: 0 }]))).status, 400);
  assert.equal((await commit(hub, operation(initial.workspaceId, [{ path: '笔记.md', hash: null, expectedVersion: 1 }]))).status, 200);
  assert.equal((await (await hub.request('manifest')).json()).revision, 2);
  await hub.close();
  const priorState = await readFile(path.join(hub.root, 'state.json'));
  const restarted = await data.start(hub.root);
  assert.deepEqual(await readFile(path.join(hub.root, 'state.json')), priorState);
  assert.deepEqual(await (await commit(restarted, body)).json(), receipt);
  assert.equal((await (await restarted.request('manifest')).json()).revision, 2);
  assert.deepEqual(JSON.parse(await readFile(path.join(hub.root, 'history/0.json'), 'utf8')), initial);
  assert.equal(JSON.parse(priorState).manifest.files['笔记.md'].hash, null);
  assert.equal(JSON.parse(priorState).manifest.files['removed.md'].hash, null);
});

test('loads legacy manifest and valid pre-core state/receipts without changing identity or bytes', async t => {
  const data = await fixture(t); const root = path.join(data.directory, 'legacy');
  await mkdir(root);
  const workspaceId = randomUUID();
  const body = operation(workspaceId, [{ path: 'old.md', hash: null, expectedVersion: 0 }]);
  const manifest = { workspaceId, revision: 1, files: { 'old.md': { hash: null, version: 1 } } };
  await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest));
  const imported = await data.start(root);
  assert.deepEqual(await (await imported.request('manifest')).json(), manifest);
  await imported.close();
  const receipt = { workspaceId, operationId: body.operationId, revision: 1, files: manifest.files };
  const original = JSON.stringify({ manifest, receipts: { [`${body.deviceId}:${body.operationId}`]: {
    fingerprint: digest(JSON.stringify({ workspaceId, changes: body.changes.map(({ path, expectedVersion, hash }) => ({ path, expectedVersion, hash })) })), receipt,
  } } }, null, 3);
  await writeFile(path.join(root, 'state.json'), original);
  const loaded = await data.start(root);
  assert.equal(await readFile(path.join(root, 'state.json'), 'utf8'), original);
  assert.deepEqual(await (await commit(loaded, body)).json(), receipt);
  await assert.rejects(createSyncServer({ root, token }), /in use/);
});

test('preserves shared-gateway exports, handler order and dedicated route boundaries', async t => {
  let original = 0; let mojian = 0;
  const gateway = { server: http.createServer((_req, res) => { original++; res.end('dayweave'); }) };
  addFileSyncRoute(gateway, (req, res) => {
    if (req.url !== '/mojian') return false;
    mojian++; res.end('mojian'); return true;
  });
  await new Promise(resolve => gateway.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => gateway.server.close(resolve)));
  const base = `http://127.0.0.1:${gateway.server.address().port}`;
  assert.equal(await (await fetch(base + '/dayweave')).text(), 'dayweave');
  assert.equal(await (await fetch(base + '/mojian')).text(), 'mojian');
  assert.equal((await fetch(base + '/webobsidian-sync/v1/manifest?query=1')).status, 404);
  assert.equal(original, 1); assert.equal(mojian, 1);
  assert.equal(typeof routeWebObsidian, 'function');
  const unexpected = { server: http.createServer() };
  assert.throws(() => addFileSyncRoute(unexpected, () => false), /Unexpected/);
});

test('rejects malformed/oversize commits, missing blobs, path aliases and wrong workspace without advancing state', async t => {
  const data = await fixture(t); const hub = await data.start();
  const initial = await (await hub.request('manifest')).json();
  assert.equal((await hub.request('commit', { method: 'POST', body: '{' })).status, 400);
  assert.equal((await hub.request('commit', { method: 'POST', body: ' '.repeat(4 * 1024 * 1024 + 1) })).status, 413);
  assert.equal((await commit(hub, operation(randomUUID(), [{ path: 'x', hash: null, expectedVersion: 0 }]))).status, 409);
  assert.equal((await commit(hub, operation(initial.workspaceId, [{ path: 'x', hash: digest('missing'), expectedVersion: 0 }]))).status, 422);
  assert.equal((await commit(hub, operation(initial.workspaceId, [
    { path: 'Case.md', hash: null, expectedVersion: 0 }, { path: 'case.md', hash: null, expectedVersion: 0 },
  ]))).status, 400);
  assert.deepEqual(await (await hub.request('manifest')).json(), initial);
  assert.equal((await commit(hub, operation(initial.workspaceId, [{ path: 'Case.md', hash: null, expectedVersion: 0 }]))).status, 200);
  assert.equal((await commit(hub, operation(initial.workspaceId, [{ path: 'case.md', hash: null, expectedVersion: 0 }]))).status, 400);
});
