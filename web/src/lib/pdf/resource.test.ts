import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ loading: undefined as any, page: undefined as any, document: undefined as any }));
vi.mock('../api', () => ({ request: vi.fn(async () => ''), vaultRequestIdentity: async () => 'vault-A', api: { rawUrl: (path: string) => `/api/files/content?path=${path}&vault=vault-A` } }));
vi.mock('./runtime', () => ({ loadPdf: vi.fn(() => fixture.loading) }));
import { PdfResource, acquirePdfResource } from './resource';

beforeEach(() => {
  fixture.page = {
    cleanup: vi.fn(() => true),
    getViewport: ({ scale }: { scale: number }) => ({ width: 612 * scale, height: 792 * scale, scale, transform: [scale, 0, 0, -scale, 0, 792 * scale] }),
    getTextContent: vi.fn(async () => ({ items: [], styles: {}, lang: null })),
    render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
  };
  fixture.document = { numPages: 80, getPage: vi.fn(async () => fixture.page), getOutline: vi.fn(async () => []), getDestination: vi.fn(), getPageIndex: vi.fn() };
  fixture.loading = { promise: Promise.resolve(fixture.document), destroy: vi.fn(async () => {}) };
  vi.stubGlobal('window', { devicePixelRatio: 1 });
});
afterEach(() => { vi.unstubAllGlobals(); });

it('shares one document per Vault/path and destroys only when its last owner releases', async () => {
  const first = await acquirePdfResource('shared.pdf', new AbortController().signal);
  const second = await acquirePdfResource('shared.pdf', new AbortController().signal);
  expect(first.resource).toBe(second.resource);
  await first.resource.ready;
  first.release(); expect(fixture.loading.destroy).not.toHaveBeenCalled();
  second.release(); await Promise.resolve();
  expect(fixture.loading.destroy).toHaveBeenCalledTimes(1);
});

it('shares a page between text and render and never cleans it while rendering', async () => {
  const resource = new PdfResource('paper.pdf', 'vault-A', '/scoped'); await resource.ready;
  let finish!: () => void, started!: () => void;
  const rendering = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { finish = resolve; });
  fixture.page.render.mockImplementation(() => { started(); return { promise: gate, cancel: vi.fn() }; });
  const pending = resource.render(1, { style: {} } as HTMLCanvasElement, 612, new AbortController().signal);
  await rendering;
  await resource.text(1);
  expect(fixture.document.getPage).toHaveBeenCalledTimes(1);
  expect(fixture.page.cleanup).not.toHaveBeenCalled();
  finish(); await pending;
  expect(fixture.page.cleanup).toHaveBeenCalledTimes(1);
  await resource.text(1); expect(fixture.page.getTextContent).toHaveBeenCalledTimes(1);
  await resource.destroy();
});

it('cancels live rendering on destroy and rejects late completion without cleanup during render', async () => {
  const resource = new PdfResource('paper.pdf', 'vault-A', '/scoped'); await resource.ready;
  let fail!: (error: Error) => void, started!: () => void;
  const rendering = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>((_resolve, reject) => { fail = reject; });
  const cancel = vi.fn(() => fail(new DOMException('cancelled', 'AbortError')));
  fixture.page.render.mockImplementation(() => { started(); return { promise: gate, cancel }; });
  const pending = resource.render(1, { style: {} } as HTMLCanvasElement, 612, new AbortController().signal);
  const failure = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  await rendering; await resource.destroy(); await failure;
  expect(cancel).toHaveBeenCalled(); expect(fixture.page.cleanup).not.toHaveBeenCalled();
  expect(fixture.loading.destroy).toHaveBeenCalledTimes(1);
});

it('reads only embedded local destinations and does not run outline URLs or actions', async () => {
  fixture.document.getOutline.mockResolvedValue([
    { title: 'named', dest: 'chapter', items: [] },
    { title: 'remote', dest: null, url: 'https://example.com', action: 'JavaScript', items: [] },
  ]);
  fixture.document.getDestination.mockResolvedValue([{ num: 8, gen: 0 }, { name: 'Fit' }]);
  fixture.document.getPageIndex.mockResolvedValue(19);
  const resource = new PdfResource('paper.pdf', 'vault-A', '/scoped');
  expect(await resource.outline()).toEqual([{ title: 'named', page: 20, children: [] }, { title: 'remote', page: null, children: [] }]);
  expect(fixture.document.getDestination).toHaveBeenCalledWith('chapter');
  await resource.destroy();
});
