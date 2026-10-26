import { beforeEach, expect, it, vi } from 'vitest';
import { contentTargets, DocumentSession, type DocumentSnapshot } from '@webobsidian/markdown-core';

const fixture = vi.hoisted(() => ({
  sessions: new Map<string, DocumentSession>(),
  listeners: new Set<(snapshot: DocumentSnapshot) => void>(), search: new Set<() => void>(),
  resolve: vi.fn(),
}));
vi.mock('./documents', () => ({ documents: {
  get: (path: string) => fixture.sessions.get(path), snapshots: () => [...fixture.sessions.values()].map(session => session.snapshot),
  open: async (path: string) => fixture.sessions.get(path),
  subscribe: (listener: (snapshot: DocumentSnapshot) => void) => { fixture.listeners.add(listener); return () => fixture.listeners.delete(listener); },
} }));
vi.mock('./contentReferences', () => ({ resolveContentLink: fixture.resolve }));
vi.mock('./api', () => ({ api: {} }));
vi.mock('./tags/actions', () => ({ nativeTagMenuItems: vi.fn(), openNativeTagPage: vi.fn(), searchNativeTag: vi.fn(), showNativeTagHover: vi.fn(), hideNativeTagHover: vi.fn() }));
vi.mock('./nativeFeaturePreferences', () => ({ tagPreferences: () => ({}) }));
vi.mock('./configuredMenus/transform', () => ({ menuModifiers: vi.fn() }));
vi.mock('./search', () => ({ searchTags: vi.fn(), subscribeSearch: (listener: () => void) => { fixture.search.add(listener); return () => fixture.search.delete(listener); } }));
vi.mock('./propertyTypes', () => ({ propertyTypesSnapshot: () => ({}), setPropertyType: vi.fn() }));

import { createVaultRenderContext } from './vaultRenderContext';

function add(path: string, text: string) {
  const session = new DocumentSession(path, text, undefined, async () => ({}));
  fixture.sessions.set(path, session);
  session.subscribe(() => { for (const listener of fixture.listeners) listener(session.snapshot); });
  return session;
}
const context = () => createVaultRenderContext('host.md', { openLink: vi.fn(), openMenu: vi.fn(), files: () => [] });
beforeEach(() => {
  fixture.sessions.clear(); fixture.listeners.clear(); fixture.search.clear(); fixture.resolve.mockReset();
  fixture.resolve.mockImplementation(async () => {
    const matches = [...fixture.sessions.values()].filter(session => contentTargets(session.analysis).targets.some(target => target.id === 'heading-target'));
    return { path: matches.length === 1 ? matches[0].id : null };
  });
});

it('keeps normal input local, immediately disables duplicates and recovers without remount', async () => {
  const first = add('first.md', '# First ^heading-target\n\nbody'), second = add('second.md', 'empty');
  const controller = new AbortController(), note = (await context().renderEmbed('^heading-target', controller.signal))!;
  const stop = note.subscribe(vi.fn());
  const binding = note.edit!;
  first.setText('# First ^heading-target\n\nchanged');
  second.setText('unrelated');
  await Promise.resolve();
  expect(fixture.resolve).toHaveBeenCalledTimes(1);
  second.setText('# Duplicate ^heading-target\n\nbody');
  expect(note.read()).toBeNull();
  expect(note.edit).toBeUndefined();
  expect(binding.resolveRange(first.analysis)).toBeNull();
  await vi.waitFor(() => expect(fixture.resolve).toHaveBeenCalledTimes(2));
  second.setText('removed');
  await vi.waitFor(() => expect(note.read()?.source).toContain('changed'));
  stop(); controller.abort();
  expect(fixture.listeners.size).toBe(0); expect(fixture.search.size).toBe(0);
});

it('retargets moved IDs, invalidates an old edit binding and ignores cancelled resolutions', async () => {
  const first = add('first.md', '# First ^heading-target\n\nold'), second = add('second.md', 'empty');
  const controller = new AbortController(), note = (await context().renderEmbed('^heading-target', controller.signal))!;
  const stop = note.subscribe(vi.fn()), binding = note.edit!;
  first.setText('removed'); second.setText('# Second ^heading-target\n\nnew');
  expect(note.read()).toBeNull();
  await vi.waitFor(() => expect(note.path).toBe('second.md'));
  expect(note.context.sourcePath).toBe('second.md');
  expect(note.edit!.session).toBe(second);
  expect(binding.resolveRange(first.analysis)).toBeNull();
  let finish!: (result: { path: string }) => void;
  fixture.resolve.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  for (const listener of fixture.search) listener();
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  stop(); controller.abort(); finish({ path: 'first.md' });
  await Promise.resolve(); await Promise.resolve();
  expect(note.path).toBe('second.md');
});

it('recovers an initially missing global target through registry updates without a new resolver object', async () => {
  const session = add('later.md', 'empty');
  const controller = new AbortController(), note = await context().renderEmbed('^heading-target', controller.signal);
  expect(note).not.toBeNull(); expect(note!.read()).toBeNull(); expect(note!.edit).toBeUndefined();
  const stop = note!.subscribe(vi.fn());
  await vi.waitFor(() => expect(fixture.resolve).toHaveBeenCalledTimes(2));
  session.setText('# Available ^heading-target\n\nbody');
  expect(note!.edit).toBeUndefined();
  await vi.waitFor(() => expect(note!.read()?.source).toContain('Available'));
  expect(note!.edit?.session).toBe(session); expect(note!.path).toBe('later.md');
  controller.abort(); stop();
  expect(fixture.listeners.size).toBe(0); expect(fixture.search.size).toBe(0);
});

it('recovers an initially ambiguous global target when registry changes leave one candidate', async () => {
  const first = add('first.md', '# First ^heading-target\n\nbody');
  const second = add('second.md', '# Second ^heading-target\n\nbody');
  const controller = new AbortController(), note = (await context().renderEmbed('^heading-target', controller.signal))!;
  expect(note.read()).toBeNull(); expect(note.edit).toBeUndefined();
  const stop = note.subscribe(vi.fn());
  await vi.waitFor(() => expect(fixture.resolve).toHaveBeenCalledTimes(2));
  first.setText('removed');
  await vi.waitFor(() => expect(note.read()?.source).toContain('Second'));
  expect(note.edit?.session).toBe(second);
  stop(); controller.abort();
});

it('recovers a new target announced by search and retains legacy missing-file null', async () => {
  const controller = new AbortController(), note = (await context().renderEmbed('^heading-target', controller.signal))!;
  const stop = note.subscribe(vi.fn());
  await vi.waitFor(() => expect(fixture.resolve).toHaveBeenCalledTimes(2));
  const session = add('new.md', '# New ^heading-target\n\nbody');
  for (const listener of fixture.search) listener();
  await vi.waitFor(() => expect(note.edit?.session).toBe(session));
  stop(); controller.abort();
  fixture.resolve.mockResolvedValue({ path: null });
  expect(await context().renderEmbed('missing-file', new AbortController().signal)).toBeNull();
});
