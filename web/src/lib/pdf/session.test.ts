import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { pageText } from './text';
const fixture = vi.hoisted(() => ({ resource: undefined as any, release: vi.fn() }));
vi.mock('./resource', () => ({ acquirePdfResource: async () => ({ resource: fixture.resource, release: fixture.release }) }));
import { PdfSession } from './session';

const sessions: PdfSession[] = [];
function open() { const session = new PdfSession('paper.pdf'); sessions.push(session); return session; }
function text(value: string) {
  return pageText({ items: [{ str: value, dir: 'ltr', width: 100, height: 20, transform: [20, 0, 0, 20, 40, 720], fontName: 'font', hasEOL: true }], styles: {}, lang: null },
    { width: 612, height: 792, transform: [1, 0, 0, -1, 0, 792] });
}
beforeEach(() => {
  fixture.release.mockClear();
  fixture.resource = { ready: Promise.resolve({ numPages: 80 }), outline: async () => [], text: vi.fn(async () => text('needle')) };
});
afterEach(() => { for (const session of sessions.splice(0)) session.destroy(); });

it('indexes matches by page, batches search progress and reuses the index during page navigation', async () => {
  const session = open(); await session.ready;
  let notifications = 0; session.subscribe(() => { notifications++; });
  session.setQuery('needle');
  await vi.waitFor(() => expect(session.getSnapshot().searchPending).toBe(false));
  const before = session.getSnapshot();
  expect(before.matches).toHaveLength(80);
  expect(before.matchesByPage[70][0]).toBe(before.matches[69]);
  expect(notifications).toBeLessThan(16);
  session.goToPage(70);
  expect(session.getSnapshot().matchesByPage).toBe(before.matchesByPage);
  expect(session.getSnapshot().currentPage).toBe(70);
});

it('discards a delayed old query after replacement and never publishes after destroy', async () => {
  let finish!: (value: ReturnType<typeof text>) => void;
  const gate = new Promise<ReturnType<typeof text>>(resolve => { finish = resolve; });
  fixture.resource.text.mockReturnValueOnce(gate);
  const session = open(); await session.ready;
  session.setQuery('old'); await Promise.resolve();
  session.setQuery('needle');
  await vi.waitFor(() => expect(session.getSnapshot().searchPending).toBe(false));
  expect(session.getSnapshot().matches).toHaveLength(80);
  finish(text('old')); await Promise.resolve();
  expect(session.getSnapshot().query).toBe('needle');
  session.destroy();
  const destroyed = session.getSnapshot();
  session.setQuery('late'); await Promise.resolve();
  expect(session.getSnapshot()).toBe(destroyed);
  expect(fixture.release).toHaveBeenCalledTimes(1);
});
