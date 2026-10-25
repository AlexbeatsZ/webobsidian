import { describe, expect, it, vi } from 'vitest';
import { Component } from './events';
import { RenderLifetime } from './renderLifetime';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

describe('architecture renderer loading cycles', () => {
  it('cleans late onload registration and children after unloading', async () => {
    const gate = deferred(), cleanup = vi.fn(), child = new Component();
    const childCleanup = vi.fn(); child.register(childCleanup);
    const component = new Component();
    component.onload = async () => { await gate.promise; component.register(cleanup); component.addChild(child); };
    const loading = component.load(); component.unload(); gate.resolve(); await loading;
    component.unload();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(childCleanup).toHaveBeenCalledTimes(1);
  });

  it('serializes reload behind cancelled onload without mixing registrations', async () => {
    const gate = deferred(), firstCleanup = vi.fn(), secondCleanup = vi.fn();
    const component = new Component(); let calls = 0;
    component.onload = async () => {
      calls++;
      if (calls === 1) { await gate.promise; component.register(firstCleanup); }
      else component.register(secondCleanup);
    };
    const initial = component.load(); component.unload();
    const reloaded = component.load(), sameReload = component.load();
    expect(calls).toBe(1); gate.resolve(); await Promise.all([initial, reloaded, sameReload]);
    expect(calls).toBe(2); expect(firstCleanup).toHaveBeenCalledTimes(1);
    expect(secondCleanup).not.toHaveBeenCalled(); component.unload();
    expect(secondCleanup).toHaveBeenCalledTimes(1);
  });

  it('preserves preload registration and repeated ordinary reload', async () => {
    const component = new Component(), preload = vi.fn(), cleanup = vi.fn();
    component.register(preload); component.onload = () => component.register(cleanup);
    await component.load(); component.unload(); await component.load(); component.unload();
    expect(preload).toHaveBeenCalledTimes(1); expect(cleanup).toHaveBeenCalledTimes(2);
  });

  it('releases preloaded resources when cancelled before load', () => {
    const component = new Component(), cleanup = vi.fn(); component.register(cleanup);
    component.unload(); component.unload(); expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('preserves explicit preload registration between completed cycles', async () => {
    const component = new Component(), cleanup = vi.fn(), child = new Component(), childCleanup = vi.fn();
    await component.load(); component.unload();
    component.register(cleanup); child.register(childCleanup); component.addChild(child);
    expect(cleanup).not.toHaveBeenCalled(); expect(childCleanup).not.toHaveBeenCalled();
    await component.load(); component.unload();
    expect(cleanup).toHaveBeenCalledTimes(1); expect(childCleanup).toHaveBeenCalledTimes(1);
  });

  it('cleans registration after synchronous self-unload inside onload', async () => {
    const component = new Component(), cleanup = vi.fn();
    component.onload = () => { component.unload(); component.register(cleanup); };
    await component.load(); expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('cleans partial resources on rejected onload and permits retry', async () => {
    const component = new Component(), cleanup = vi.fn();
    component.onload = () => { component.register(cleanup); throw new Error('fixture failed'); };
    await expect(component.load()).rejects.toThrow('fixture failed');
    expect(cleanup).toHaveBeenCalledTimes(1);
    component.onload = () => component.register(cleanup);
    await component.load(); component.unload(); expect(cleanup).toHaveBeenCalledTimes(2);
  });

  it('terminal render lifetime never restarts and cleans pending children', async () => {
    const lifetime = new RenderLifetime(), child = new Component(), gate = deferred(), cleanup = vi.fn();
    child.onload = async () => { await gate.promise; child.register(cleanup); };
    lifetime.addChild(child); const loading = lifetime.load();
    await Promise.resolve(); lifetime.unload(); gate.resolve(); await loading; await lifetime.load();
    expect(lifetime.signal.aborted).toBe(true); expect(cleanup).toHaveBeenCalledTimes(1);
    expect(() => lifetime.assertActive()).toThrow();
  });
});
