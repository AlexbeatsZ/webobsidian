import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createFileSyncServer } from '@alexbeatsz/file-sync-core';
import { prefix, validPath, validateManifest } from './protocol.mjs';
import { runCli } from './cli.mjs';

export async function createSyncServer({ root, token, maxBlobBytes = 1024 * 1024 * 1024 }) {
  return createFileSyncServer({
    root, token, maxBlobBytes, routePrefix: prefix, validPath, validateManifest,
    validateToken(value) {
      if (typeof value !== 'string' || !/^[\x21-\x7e]{32,512}$/.test(value)) {
        throw new Error('WEBOBSIDIAN_SYNC_TOKEN must contain 32-512 printable ASCII characters');
      }
    },
    validateRequest: (request, url) => !request.headers.origin && !url.search && !request.url.includes('#'),
    onError: ({ code }) => console.error('WebObsidian sync request failed:', code),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { await runCli(createSyncServer); }
  catch (error) {
    // Startup diagnostics must not expose a configuration token or private paths.
    console.error('WebObsidian sync startup failed:', error.code ?? error.name);
    process.exitCode = 1;
  }
}
