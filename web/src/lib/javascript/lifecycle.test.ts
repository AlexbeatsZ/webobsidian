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
