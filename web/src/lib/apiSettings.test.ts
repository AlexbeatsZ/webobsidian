import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('settings success notifications', () => {
  it('publishes the persisted response and never publishes a failed save', async () => {
    class DetailEvent extends Event {
      detail: unknown;
      constructor(type: string, options: { detail: unknown }) { super(type); this.detail = options.detail; }
    }
    const target = new EventTarget(), listener = vi.fn();
    target.addEventListener('settings-changed', listener);
    vi.stubGlobal('window', target); vi.stubGlobal('CustomEvent', DetailEvent);
    const persisted = { ui: { fontTextSize: 24, fileLineWidth: 900 } };
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ vault: 'fixture' }), { headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(persisted), { headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'disk busy' }), { status: 507, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    const { api, pendingMutations } = await import('./api');
    expect(await api.putSettings({ ui: { fontTextSize: 24 } })).toEqual(persisted);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].detail).toEqual(persisted);
    await expect(api.putSettings({ ui: { fileLineWidth: 1200 } })).rejects.toThrow('disk busy');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(pendingMutations()).toBe(0);
  });

  it('serializes delayed responses, counts queued writes and recovers after failure', async () => {
    let release!: (response: Response) => void;
    const delayed = new Promise<Response>(resolve => { release = resolve; });
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ vault: 'fixture' }), { headers: { 'Content-Type': 'application/json' } }))
      .mockReturnValueOnce(delayed)
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'disk busy' }), { status: 507, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ui: { fontTextSize: 28 } }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    const { api, pendingMutations } = await import('./api');
    const first = api.putSettings({ ui: { fontTextSize: 24 } });
    const failed = api.putSettings({ ui: { fontTextSize: 26 } });
    const last = api.putSettings({ ui: { fontTextSize: 28 } });
    const rejected = expect(failed).rejects.toThrow('disk busy');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(pendingMutations()).toBe(3);
    release(new Response(JSON.stringify({ ui: { fontTextSize: 24 } }), { headers: { 'Content-Type': 'application/json' } }));
    expect((await first).ui.fontTextSize).toBe(24);
    await rejected;
    expect((await last).ui.fontTextSize).toBe(28);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(pendingMutations()).toBe(0);
  });

  it('does not queue a UI write behind a Vault switch waiting for mutations to drain', async () => {
    let finishSwitch!: (response: Response) => void;
    const switching = new Promise<Response>(resolve => { finishSwitch = resolve; });
    const fetch = vi.fn().mockImplementation(async (url: string, options?: RequestInit) => {
      const headers = { 'Content-Type': 'application/json' };
      if (url === '/api/vault-identity') return new Response(JSON.stringify({ vault: 'fixture' }), { headers });
      const patch = JSON.parse(String(options?.body));
      if (patch.vault) return switching;
      return new Response(JSON.stringify({ ui: { fontTextSize: 24 } }), { headers });
    });
    vi.stubGlobal('fetch', fetch);
    const { api, pendingMutations } = await import('./api');
    const switchResult = api.putSettings({ vault: { path: 'next-vault' } });
    const appearance = api.putSettings({ ui: { fontTextSize: 24 } });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect((await appearance).ui.fontTextSize).toBe(24);
    expect(pendingMutations()).toBe(0);
    finishSwitch(new Response(JSON.stringify({ ui: { fontTextSize: 24 } }), { headers: { 'Content-Type': 'application/json' } }));
    await switchResult;
    expect(pendingMutations()).toBe(0);
  });
});
