import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import type { Request } from 'express';
import { broadcast, holdVaultNotifications, setBroadcaster } from './realtime.js';
import { bindMaintenanceClients, maintenanceClientMessage, withVaultMaintenance, withVaultRequest } from './vaultMaintenance.js';

vi.mock('./vaultConfiguration.js', () => ({ vaultConfigurationIdentity: async () => ({ vault: 'fixture' }) }));
afterEach(() => { setBroadcaster(() => {}); bindMaintenanceClients(() => []); });

describe('Vault notifications and the existing maintenance lease', () => {
  it('holds notifications in order and flushes only once', () => {
    const events: unknown[] = []; setBroadcaster(message => events.push(message));
    const flush = holdVaultNotifications();
    broadcast({ type: 'fs', path: 'note.md' }); broadcast({ type: 'index' }); expect(events).toEqual([]);
    flush(); flush(); expect(events).toEqual([{ type: 'fs', path: 'note.md' }, { type: 'index' }]);
  });

  it('defers adapter reads through the lease without admitting adapter writes', async () => {
    let entered!: () => void, finish!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const client = { readyState: 1, send: (raw: string) => {
      const message = JSON.parse(raw);
      if (message.phase === 'prepare') maintenanceClientMessage(client as WebSocket, { ...message, type: 'maintenance-ack', blockers: [] });
    } };
    bindMaintenanceClients(() => [client as WebSocket]);
    const maintenance = withVaultMaintenance(async () => {}, async () => { entered(); await gate; });
    await started;
    const request = (op: string) => ({ method: 'POST', originalUrl: '/api/plugins/adapter', body: { op }, query: {}, get: () => undefined }) as unknown as Request;
    let read = false;
    const reading = withVaultRequest(request('stat'), async () => { read = true; });
    try {
      await expect(withVaultRequest(request('write'), async () => {})).rejects.toMatchObject({ status: 409 });
      expect(read).toBe(false);
    } finally { finish(); await maintenance; }
    await reading; expect(read).toBe(true);
  });

  for (const fail of [false, true]) it(`releases clients before publishing file events, including failed work=${fail}`, async () => {
    const events: string[] = [];
    const client = { readyState: 1, send: (raw: string) => {
      const message = JSON.parse(raw); events.push(message.phase);
      if (message.phase === 'prepare' || message.phase === 'inspect') maintenanceClientMessage(client as WebSocket, { ...message, type: 'maintenance-ack', blockers: [] });
    } };
    bindMaintenanceClients(() => [client as WebSocket]); setBroadcaster(() => events.push('file-event'));
    const work = withVaultMaintenance(async () => {}, async () => {
      broadcast({ type: 'fs', path: 'note.md' }); expect(events).not.toContain('file-event');
      if (fail) throw new Error('fixture partial publication');
    });
    if (fail) await expect(work).rejects.toThrow('fixture partial publication'); else await work;
    expect(events.indexOf('release')).toBeLessThan(events.indexOf('file-event'));
  });
});
