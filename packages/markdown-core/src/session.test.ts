import { expect, it, vi } from 'vitest';
import { DocumentSession } from './session.js';

it('shares unsaved source and leaves edits made during a save dirty', async () => {
  let finish!: (value: { revision: string }) => void;
  const writes: string[] = [];
  const doc = new DocumentSession('note.md', 'a\r\nb', 'r1', async (_id, raw) => {
    writes.push(raw);
    return new Promise((resolve) => { finish = resolve; });
  });
  doc.edit(0, [{ from: 0, to: 1, insert: 'A' }]);
  const saving = doc.save();
  doc.edit(1, [{ from: 2, to: 3, insert: 'B' }]);
  finish({ revision: 'r2' });
  await saving;
  expect(writes).toEqual(['A\r\nb']);
  expect(doc.snapshot.raw).toBe('A\r\nB');
  expect(doc.snapshot.dirty).toBe(true);
  expect(doc.snapshot.revision).toBe('r2');
});

it('undo and redo restore the exact original source across views', () => {
  const raw = '\ufeffa\r\nb\nc\rd';
  const doc = new DocumentSession('note.md', raw, 'r1', async () => ({}));
  let notifications = 0;
  const off = doc.subscribe(() => notifications++);
  doc.edit(0, [{ from: 1, to: 6, insert: '新\n文' }]);
  const edited = doc.snapshot.raw;
  expect(doc.undo()).toBe(true);
  expect(doc.snapshot.raw).toBe(raw);
  expect(doc.snapshot.dirty).toBe(false);
  expect(doc.redo()).toBe(true);
  expect(doc.snapshot.raw).toBe(edited);
  expect(notifications).toBe(3);
  off();
});

it('does not write an unchanged document or overwrite dirty content from outside', async () => {
  let writes = 0;
  const doc = new DocumentSession('a.md', 'original', 'r1', async () => { writes++; return {}; });
  await doc.save();
  expect(writes).toBe(0);
  doc.setText('local');
  expect(doc.acceptExternal('remote', 'r2')).toBe(false);
  expect(doc.snapshot.raw).toBe('local');
  await expect(doc.save()).rejects.toThrow('conflict');
  expect(writes).toBe(0);
});

it('rejects stale view edits and serializes saves using the new revision', async () => {
  const calls: { raw: string; revision?: string }[] = [];
  const finish: ((value: { revision: string }) => void)[] = [];
  const doc = new DocumentSession('a.md', 'a', 'r1', async (_id, raw, revision) => {
    calls.push({ raw, revision });
    return new Promise((resolve) => finish.push(resolve));
  });
  doc.setText('b');
  expect(() => doc.edit(0, [{ from: 0, to: 1, insert: 'stale' }])).toThrow();
  const saving = doc.save();
  doc.setText('c');
  const again = doc.save();
  finish[0]({ revision: 'r2' });
  await vi.waitFor(() => expect(calls).toHaveLength(2));
  expect(calls).toEqual([{ raw: 'b', revision: 'r1' }, { raw: 'c', revision: 'r2' }]);
  finish[1]({ revision: 'r3' });
  await Promise.all([saving, again]);
  expect(doc.snapshot.dirty).toBe(false);
  expect(doc.snapshot.revision).toBe('r3');
});
