import { afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { routeWebObsidian } from '../../../sync-server/gateway-route.mjs';
import { addFileSyncRoute } from '../../../sync-server/shared-gateway.mjs';

let server: http.Server | undefined;
afterEach(async () => { if (server?.listening) await new Promise<void>(resolve => server!.close(() => resolve())); });

describe('shared Sakura gateway route', () => {
  it('preserves existing Mojian and other service handlers and rejects non-protocol routes', async () => {
    server = http.createServer((_request, response) => response.end('original Dayweave/subscription handler'));
    addFileSyncRoute({ server }, (request: http.IncomingMessage, response: http.ServerResponse) => {
      if (!request.url?.startsWith('/mojian-sync/')) return false;
      response.end('existing Mojian handler'); return true;
    });
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    expect(await (await fetch(base + '/subscriptions/test')).text()).toBe('original Dayweave/subscription handler');
    expect(await (await fetch(base + '/mojian-sync/v1/manifest')).text()).toBe('existing Mojian handler');
    for (const route of ['/webobsidian-sync/v1/commit?token=secret', '/webobsidian-sync/v1/anything']) {
      expect((await fetch(base + route)).status).toBe(404);
    }
    expect((await fetch(base + '/webobsidian-sync/v1/manifest', { headers: { Origin: 'https://evil.example' } })).status).toBe(403);
  });

  it('does not claim unrelated request prefixes', () => {
    expect(routeWebObsidian({ url: '/api/settings' } as http.IncomingMessage, {} as http.ServerResponse)).toBe(false);
    expect(routeWebObsidian({ url: '/webobsidian-synchronization' } as http.IncomingMessage, {} as http.ServerResponse)).toBe(false);
  });
});
