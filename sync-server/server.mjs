import http from 'node:http';
import path from 'node:path';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, open, stat, unlink } from 'node:fs/promises';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';

import { prefix, defaultPort, validPath, hashPattern, idPattern, validateManifest } from './protocol.mjs';

async function atomicJson(target, value) {
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, 'wx');
    try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temporary, target);
    await syncDirectory(path.dirname(target));
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

async function syncDirectory(target) {
  if (process.platform === 'win32') return;
  const directory = await open(target, 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}

async function acquireLock(root) {
  const lockPath = path.join(root, 'server.lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const lock = await open(lockPath, 'wx');
      await lock.writeFile(String(process.pid));
      await lock.sync();
      return async () => { await lock.close(); await unlink(lockPath); };
    } catch (error) {
      if (error.code !== 'EEXIST' || attempt) throw error;
      const owner = Number(await readFile(lockPath, 'utf8'));
      if (!Number.isSafeInteger(owner) || owner <= 0) throw new Error('Invalid lock; manual recovery required');
      try { process.kill(owner, 0); throw new Error('Sync data root is already in use'); }
      catch (failure) { if (failure.code !== 'ESRCH') throw failure; }
      await unlink(lockPath);
    }
  }
}

export async function createSyncServer({ root, token, maxBlobBytes = 1024 * 1024 * 1024 }) {
  if (typeof token !== 'string' || !/^[\x21-\x7e]{32,512}$/.test(token)) throw new Error('WEBOBSIDIAN_SYNC_TOKEN must contain 32-512 printable ASCII characters');
  root = path.resolve(root);
  await mkdir(path.join(root, 'blobs'), { recursive: true });
  await mkdir(path.join(root, 'history'), { recursive: true });
  const release = await acquireLock(root);
  const statePath = path.join(root, 'state.json');
  let state;
  try {
    try { state = JSON.parse(await readFile(statePath, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      let manifest;
      try { manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8')); }
      catch (failure) {
        if (failure.code !== 'ENOENT') throw failure;
        manifest = { workspaceId: randomUUID(), revision: 0, files: {} };
      }
      state = { manifest, receipts: {} };
      validateManifest(manifest);
      await atomicJson(statePath, state);
    }
    validateManifest(state.manifest);
    if (!state.receipts || typeof state.receipts !== 'object' || Array.isArray(state.receipts)) throw new Error('Invalid stored receipts');
    for (const [key, record] of Object.entries(state.receipts)) {
      const parts = key.split(':');
      const receipt = record?.receipt;
      if (parts.length !== 2 || !parts.every(part => idPattern.test(part)) || !hashPattern.test(record?.fingerprint) ||
          !receipt || receipt.workspaceId !== state.manifest.workspaceId || receipt.operationId !== parts[1] ||
          receipt.revision > state.manifest.revision) throw new Error('Invalid stored receipt');
      validateManifest({ workspaceId: receipt.workspaceId, revision: receipt.revision, files: receipt.files });
    }
  } catch (error) { await release(); throw error; }
  let commits = Promise.resolve();
  let storageFailed = false;
  const expectedToken = Buffer.from(`Bearer ${token}`);
  const json = (response, status, body) => {
    if (response.destroyed) return;
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(body));
  };
  const server = http.createServer(async (request, response) => {
    try {
      const auth = Buffer.from(request.headers.authorization ?? '');
      if (auth.length !== expectedToken.length || !timingSafeEqual(auth, expectedToken)) {
        json(response, 401, { error: 'unauthorized' }); return;
      }
      const url = new URL(request.url, 'http://localhost');
      if (request.headers.origin || url.search || request.url.includes('#')) { json(response, 400, { error: 'invalid_request' }); return; }
      if (storageFailed) { json(response, 503, { error: 'storage_failure' }); return; }
      if (url.pathname === `${prefix}/manifest` && request.method === 'GET') {
        json(response, 200, state.manifest); return;
      }
      const blobHash = url.pathname.startsWith(`${prefix}/blobs/`) ? url.pathname.slice(`${prefix}/blobs/`.length) : '';
      if (hashPattern.test(blobHash)) {
        const blobPath = path.join(root, 'blobs', blobHash);
        if (request.method === 'GET') {
          let size;
          try { size = (await stat(blobPath)).size; }
          catch (error) { if (error.code !== 'ENOENT') throw error; json(response, 404, { error: 'blob_missing' }); return; }
          response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': size, 'Cache-Control': 'no-store' });
          await pipeline(createReadStream(blobPath), response); return;
        }
        if (request.method === 'PUT') {
          const temporary = path.join(root, 'blobs', `${randomUUID()}.tmp`);
          let bytes = 0;
          let oversized = false;
          const hash = createHash('sha256');
          try {
            await pipeline(request, new Transform({ transform(chunk, encoding, callback) {
              bytes += chunk.length;
              if (bytes > maxBlobBytes) { oversized = true; callback(null); return; }
              hash.update(chunk); callback(null, chunk);
            } }), createWriteStream(temporary, { flags: 'wx' }));
            if (oversized) { json(response, 413, { error: 'blob_too_large' }); return; }
            if (hash.digest('hex') !== blobHash) { json(response, 422, { error: 'hash_mismatch' }); return; }
            const handle = await open(temporary, 'r+');
            try { await handle.sync(); } finally { await handle.close(); }
            try { await rename(temporary, blobPath); }
            catch (error) { if (error.code !== 'EEXIST' && error.code !== 'EPERM') throw error; await stat(blobPath); }
            await syncDirectory(path.dirname(blobPath));
            json(response, 200, { hash: blobHash });
          } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
          return;
        }
      }
      if (url.pathname === `${prefix}/commit` && request.method === 'POST') {
        const chunks = [];
        let bytes = 0;
        for await (const chunk of request) {
          bytes += chunk.length;
          if (bytes <= 4 * 1024 * 1024) chunks.push(chunk);
        }
        if (bytes > 4 * 1024 * 1024) { json(response, 413, { error: 'request_too_large' }); return; }
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { json(response, 400, { error: 'invalid_json' }); return; }
        if (!body || typeof body.deviceId !== 'string' || typeof body.operationId !== 'string' || !idPattern.test(body.deviceId) || !idPattern.test(body.operationId) ||
            !Array.isArray(body.changes) || !body.changes.length || body.changes.length > 20000 ||
            body.changes.some(change => !change || !validPath(change.path) || !Number.isSafeInteger(change.expectedVersion) || change.expectedVersion < 0 ||
              (change.hash !== null && (typeof change.hash !== 'string' || !hashPattern.test(change.hash)))) ||
            new Set(body.changes.map(change => change.path.toLowerCase())).size !== body.changes.length) {
          json(response, 400, { error: 'invalid_commit' }); return;
        }
        const changes = body.changes.map(({ path: name, expectedVersion, hash }) => ({ path: name, expectedVersion, hash }))
          .sort((first, second) => first.path < second.path ? -1 : first.path > second.path ? 1 : 0);
        const fingerprint = createHash('sha256').update(JSON.stringify({ workspaceId: body.workspaceId, changes })).digest('hex');
        const key = `${body.deviceId}:${body.operationId}`;
        const commit = async () => {
          if (storageFailed) { json(response, 503, { error: 'storage_failure' }); return; }
          const manifest = state.manifest;
          if (body.workspaceId !== manifest.workspaceId) { json(response, 409, { error: 'workspace_mismatch' }); return; }
          const previous = state.receipts[key];
          if (previous) {
            json(response, previous.fingerprint === fingerprint ? 200 : 409,
              previous.fingerprint === fingerprint ? previous.receipt : { error: 'operation_reused' });
            return;
          }
          const aliases = new Map(Object.keys(manifest.files).map(name => [name.toLowerCase(), name]));
          if (changes.some(change => aliases.has(change.path.toLowerCase()) && aliases.get(change.path.toLowerCase()) !== change.path)) {
            json(response, 400, { error: 'invalid_path' }); return;
          }
          const conflicts = changes.filter(change => (Object.hasOwn(manifest.files, change.path) ? manifest.files[change.path].version : 0) !== change.expectedVersion).map(change => change.path);
          if (conflicts.length) { json(response, 409, { error: 'version_conflict', revision: manifest.revision, conflicts }); return; }
          for (const change of changes) if (change.hash !== null) {
            try { await stat(path.join(root, 'blobs', change.hash)); }
            catch (error) { if (error.code !== 'ENOENT') throw error; json(response, 422, { error: 'blob_missing' }); return; }
          }
          if (!Number.isSafeInteger(manifest.revision + 1)) throw new Error('Revision exhausted');
          const next = structuredClone(state);
          next.manifest.revision++;
          const files = {};
          for (const change of changes) files[change.path] = next.manifest.files[change.path] = { hash: change.hash, version: next.manifest.revision };
          try { validateManifest(next.manifest); }
          catch { json(response, 400, { error: 'invalid_path' }); return; }
          const receipt = { workspaceId: manifest.workspaceId, operationId: body.operationId, revision: next.manifest.revision, files };
          next.receipts[key] = { fingerprint, receipt };
          await atomicJson(path.join(root, 'history', `${manifest.revision}.json`), manifest);
          try { await atomicJson(statePath, next); }
          catch (error) { storageFailed = true; throw error; }
          state = next;
          json(response, 200, receipt);
        };
        const pending = commits.then(commit);
        commits = pending.catch(() => {});
        await pending; return;
      }
      json(response, 404, { error: 'not_found' });
    } catch (error) {
      if (!response.headersSent && !response.destroyed) json(response, 500, { error: 'storage_failure' });
      else response.destroy();
      console.error('WebObsidian sync request failed:', error.code ?? error.name);
    }
  });
  server.requestTimeout = 10 * 60 * 1000;
  server.headersTimeout = 30000;
  let closing;
  return {
    server,
    close: () => closing ??= (async () => {
      if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await commits;
      await release();
    })(),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const settings = process.argv[2] ? JSON.parse(await readFile(path.resolve(process.argv[2]), 'utf8')) : {};
  const service = await createSyncServer({ root: path.resolve(settings.dataDir ?? process.env.WEBOBSIDIAN_SYNC_DATA ?? './data'), token: settings.token ?? process.env.WEBOBSIDIAN_SYNC_TOKEN });
  const port = Number(settings.port ?? process.env.WEBOBSIDIAN_SYNC_PORT ?? defaultPort);
  const host = settings.host ?? process.env.WEBOBSIDIAN_SYNC_HOST ?? '127.0.0.1';
  service.server.listen(port, host, () => console.log(`WebObsidian sync listening on ${host}:${port}${prefix}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => service.close().then(() => process.exit(0)));
}
