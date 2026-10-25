import { expect, it, vi } from 'vitest';
import { JavascriptRun } from './runtime';
import { Component, Events } from '../obsidian/events';
import type { App } from '../obsidian/runtime';
import { nonExecutingContext, type RenderContext } from '../renderContext';

function fixture() {
  const vault = new Events(), remove = vi.fn();
  const app = { vault } as unknown as App;
  const context: RenderContext = { sourcePath: 'A.md', openLink() {}, openMenu() {}, rawUrl: value => value,
    files: () => [], tags: async () => [], properties: async () => [], propertyTypes: () => ({}),
    setPropertyType: async () => ({}), renderEmbed: async () => null };
  const run = new JavascriptRun(app, { remove } as unknown as HTMLElement, context, vi.fn(), vi.fn());
  void run.load(); return { run, context, vault, remove };
}
it('releases resources once and immediately disposes late registrations', () => {
  const { run, remove } = fixture(), cleanup = vi.fn(), late = vi.fn();
  run.onCleanup(cleanup); run.unload(); run.unload(); run.onCleanup(late);
  expect(cleanup).toHaveBeenCalledTimes(1); expect(late).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenCalledTimes(1); expect(run.signal.aborted).toBe(true);
  expect(() => run.watch('A.md')).toThrow();
});
it('does not start children registered after disposal', () => {
  const { run } = fixture(); run.unload();
  const child = new Component(), load = vi.spyOn(child, 'load'); run.addChild(child);
  expect(load).not.toHaveBeenCalled();
});
it('deduplicates watched paths and releases the shared event subscriptions', () => {
  const { run, vault } = fixture(), on = vi.spyOn(vault, 'on'), off = vi.spyOn(vault, 'offref');
  run.watch('A.md'); run.watch('A.md'); run.watchDirectory('folder');
  expect(on).toHaveBeenCalledTimes(4); run.unload(); expect(off).toHaveBeenCalledTimes(4);
});
it('settles pending Markdown mounting when the run is unloaded', async () => {
  const { run, context } = fixture(), stop = vi.fn();
  context.mountFragment = () => stop;
  const pending = run.renderMarkdown('text'); run.unload();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(stop).toHaveBeenCalledTimes(1);
});
it('rejects Markdown fragment failures instead of waiting until unload', async () => {
  const { run, context } = fixture(), stop = vi.fn(), failure = new Error('fragment failed');
  let options: Parameters<NonNullable<RenderContext['mountFragment']>>[2];
  context.mountFragment = (_host, _source, next) => { options = next; return stop; };
  const pending = run.renderMarkdown('text');
  const settled = pending.then(() => 'ready', error => error);
  options!.onError?.(failure);
  expect(await Promise.race([settled, new Promise(resolve => setTimeout(() => resolve('still pending'), 0))])).toBe(failure);
  run.unload();
  expect(stop).toHaveBeenCalledTimes(1);
});
it('does not measure after a disposed fragment reports ready', async () => {
  const { run, context } = fixture();
  const measure = vi.spyOn(run as unknown as { measure(): void }, 'measure');
  let ready: (() => void) | undefined;
  context.mountFragment = (_host, _source, options) => { ready = options.onReady; return () => {}; };
  const pending = run.renderMarkdown('text');
  run.unload(); ready?.();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(measure).not.toHaveBeenCalled();
});
it('removes abort listeners after a synchronous mount failure', async () => {
  const { run, context } = fixture(), failure = new Error('mount failed');
  const add = vi.spyOn(run.signal, 'addEventListener'), remove = vi.spyOn(run.signal, 'removeEventListener');
  context.mountFragment = () => { throw failure; };
  await expect(run.renderMarkdown('text')).rejects.toBe(failure);
  expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0][1]);
  run.unload();
});
it('settles a fragment once and ignores late readiness after failure', async () => {
  const { run, context } = fixture(), failure = new Error('fragment failed');
  const measure = vi.spyOn(run as unknown as { measure(): void }, 'measure');
  let options: Parameters<NonNullable<RenderContext['mountFragment']>>[2];
  context.mountFragment = (_host, _source, next) => { options = next; return () => {}; };
  const pending = run.renderMarkdown('text');
  options!.onError?.(failure); options!.onReady?.();
  await expect(pending).rejects.toBe(failure);
  expect(measure).not.toHaveBeenCalled();
  run.unload();
});
it('preserves execution denial through every embedded context', async () => {
  const { context } = fixture();
  context.allowScriptExecution = true; context.allowPlugins = true;
  context.renderEmbed = async () => ({ path: 'B.md', context, read: () => null, subscribe: () => () => {} });
  let restricted = nonExecutingContext(context);
  for (let depth = 0; depth < 4; depth++) {
    expect(restricted.allowScriptExecution).toBe(false); expect(restricted.allowPlugins).toBe(false);
    const child = await restricted.renderEmbed('B.md', new AbortController().signal); restricted = child!.context;
  }
});
