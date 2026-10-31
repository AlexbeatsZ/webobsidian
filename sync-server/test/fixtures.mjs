import path from 'node:path';
import os from 'node:os';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { createSyncServer } from '../server.mjs';
import { prefix } from '../protocol.mjs';

export const token = 'fixture-only-token-not-a-production-secret-123456';
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export async function fixture(t) {
  const parent = path.join(os.tmpdir(), '.agents');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(path.join(parent, 'webobsidian-server-test-'));
  const services = [];
  t.after(async () => {
    await Promise.all(services.map(service => service.close()));
    if (path.dirname(directory) !== parent || !path.basename(directory).startsWith('webobsidian-server-test-')) throw new Error('Unsafe fixture path');
    await rm(directory, { recursive: true, force: true, maxRetries: 3 });
  });
  return {
    directory,
    async start(root = path.join(directory, 'data'), options = {}) {
      const service = await createSyncServer({ root, token, ...options });
      services.push(service);
      await new Promise((resolve, reject) => {
        service.server.once('error', reject);
        service.server.listen(0, '127.0.0.1', resolve);
      });
      const base = `http://127.0.0.1:${service.server.address().port}${prefix}/`;
      return {
        ...service, base, root,
        request: (resource, options = {}) => fetch(base + resource, {
          ...options, headers: { Authorization: `Bearer ${token}`, ...options.headers },
        }),
      };
    },
  };
}
export function operation(workspaceId, changes) {
  return { workspaceId, deviceId: randomUUID(), operationId: randomUUID(), changes };
}
export function commit(hub, body) {
  return hub.request('commit', { method: 'POST', body: JSON.stringify(body) });
}
