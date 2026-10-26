import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentSession } from '@webobsidian/markdown-core';
import { resolveContentLink } from './contentReferences';

const state = vi.hoisted(() => ({ sessions: new Map<string, DocumentSession>(), resolve: vi.fn() }));
vi.mock('./api', () => ({ api: { resolve: state.resolve } }));
vi.mock('./documents', () => ({ documents: {
  snapshots: () => [...state.sessions.values()].map(session => session.snapshot),
  get: (path: string) => state.sessions.get(path),
} }));
beforeEach(() => { state.sessions.clear(); state.resolve.mockReset(); });

function draft(path: string, text: string) {
  const session = new DocumentSession(path, 'saved contents', undefined, async () => ({}));
  session.setText(text);
  return session;
}

describe('live content reference resolution', () => {
  it('uses a dirty moved target instead of its saved old path', async () => {
    state.resolve.mockResolvedValue({ path: 'old.md', status: 'resolved', targetOccurrences: [{ path: 'old.md', valid: true }] });
    state.sessions.set('old.md', draft('old.md', 'No target'));
    state.sessions.set('new.md', draft('new.md', '# Renamed ^heading-one\n\nBody'));
    expect(await resolveContentLink('^heading-one', '')).toMatchObject({ path: 'new.md', status: 'resolved' });
  });
  it('rejects a collision between saved and unsaved targets', async () => {
    state.resolve.mockResolvedValue({ path: 'saved.md', status: 'resolved', targetOccurrences: [{ path: 'saved.md', valid: true }] });
    state.sessions.set('draft.md', draft('draft.md', '# Draft ^heading-one'));
    expect(await resolveContentLink('^heading-one', '')).toMatchObject({ path: null, status: 'ambiguous' });
  });
  it('does not use saved targets deleted from open documents', async () => {
    state.resolve.mockResolvedValue({ path: 'old.md', targetOccurrences: [{ path: 'old.md', valid: true }] });
    state.sessions.set('old.md', draft('old.md', 'Deleted'));
    expect(await resolveContentLink('^heading-one', '')).toMatchObject({ path: null, status: 'missing' });
  });
  it('retains scoped legacy links', async () => {
    const legacy = { path: 'old.md', status: 'resolved' };
    state.resolve.mockResolvedValue(legacy);
    expect(await resolveContentLink('#^heading-one', 'old.md')).toBe(legacy);
  });
  it('does not let stale clean sessions override newer saved identities', async () => {
    state.resolve.mockResolvedValue({ path: 'new.md', status: 'resolved', targetOccurrences: [{ path: 'new.md', valid: true }] });
    state.sessions.set('old.md', new DocumentSession('old.md', '# Old ^heading-one', undefined, async () => ({})));
    expect(await resolveContentLink('^heading-one', '')).toMatchObject({ path: 'new.md', status: 'resolved' });
  });
});
