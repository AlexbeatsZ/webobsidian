import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import { api, request, vaultRequestIdentity } from '../api';
import { assertLive, aborted, pdfRenderQueue, pdfTextQueue } from './queue';
import { pageText, type PdfPageText } from './text';
import type { PdfOutlineEntry } from './types';

export class PdfResource {
  readonly lifetime = new AbortController();
  private pages = new Map<number, { promise: Promise<PDFPageProxy>; uses: number }>();
  private texts = new Map<number, Promise<PdfPageText>>();
  private tasks = new Set<RenderTask>();
  private operations = new Set<Promise<unknown>>();
  private loading?: PDFDocumentLoadingTask;
  readonly ready: Promise<PDFDocumentProxy>;
  constructor(readonly path: string, readonly vault: string, readonly url: string) {
    this.ready = this.load();
  }
  private async load() {
    const signal = this.lifetime.signal;
    await request(this.url, { method: 'HEAD', headers: { Range: 'bytes=0-0' }, vault: this.vault, signal });
    assertLive(signal);
    const { loadPdf } = await import('./runtime');
    assertLive(signal);
    this.loading = loadPdf({ url: this.url, httpHeaders: { 'X-Vault-Identity': this.vault }, withCredentials: true });
    try {
      const document = await this.loading.promise;
      assertLive(signal);
      return document;
    } catch (error) {
      if ((error as { status?: number }).status === 409 && !signal.aborted)
        await request(this.url, { method: 'HEAD', vault: this.vault, signal });
      throw error;
    }
  }
  async withPage<Result>(number: number, work: (page: PDFPageProxy) => Promise<Result>): Promise<Result> {
    assertLive(this.lifetime.signal);
    let entry = this.pages.get(number);
    if (!entry) {
      entry = { promise: this.ready.then(document => { assertLive(this.lifetime.signal); return document.getPage(number); }), uses: 0 };
      this.pages.set(number, entry);
    }
    entry.uses++;
    const operation = (async () => {
      let page: PDFPageProxy | undefined;
      try { page = await entry.promise; assertLive(this.lifetime.signal); return await work(page); }
      finally {
        entry.uses--;
        if (!entry.uses) {
          if (this.pages.get(number) === entry) this.pages.delete(number);
          if (page && !this.lifetime.signal.aborted) page.cleanup();
        }
      }
    })();
    this.operations.add(operation);
    try { return await operation; } finally { this.operations.delete(operation); }
  }
  text(number: number): Promise<PdfPageText> {
    let result = this.texts.get(number);
    if (result) { this.texts.delete(number); this.texts.set(number, result); return result; }
    result = pdfTextQueue.run(() => this.withPage(number, async page =>
      pageText(await page.getTextContent(), page.getViewport({ scale: 1 }))), this.lifetime.signal);
    this.texts.set(number, result);
    void result.catch(() => { if (this.texts.get(number) === result) this.texts.delete(number); });
    while (this.texts.size > 48) this.texts.delete(this.texts.keys().next().value!);
    return result;
  }
  async render(number: number, canvas: HTMLCanvasElement, width: number, signal: AbortSignal) {
    return pdfRenderQueue.run(async () => {
      assertLive(signal);
      return this.withPage(number, async page => {
        assertLive(signal);
        const base = page.getViewport({ scale: 1 });
        const scale = width / base.width;
        const viewport = page.getViewport({ scale });
        const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(8_000_000 / (viewport.width * viewport.height)));
        canvas.width = Math.max(1, Math.floor(viewport.width * ratio));
        canvas.height = Math.max(1, Math.floor(viewport.height * ratio));
        canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
        const task = page.render({ canvas, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
        const cancel = () => task.cancel();
        this.tasks.add(task);
        signal.addEventListener('abort', cancel, { once: true });
        this.lifetime.signal.addEventListener('abort', cancel, { once: true });
        try { await task.promise; assertLive(signal); assertLive(this.lifetime.signal); return viewport; }
        finally {
          signal.removeEventListener('abort', cancel); this.lifetime.signal.removeEventListener('abort', cancel);
          this.tasks.delete(task);
        }
      });
    }, signal);
  }
  async outline(): Promise<PdfOutlineEntry[]> {
    const document = await this.ready;
    const convert = async (items: NonNullable<Awaited<ReturnType<PDFDocumentProxy['getOutline']>>>): Promise<PdfOutlineEntry[]> => {
      const entries: PdfOutlineEntry[] = [];
      for (const item of items) {
        assertLive(this.lifetime.signal);
        let page: number | null = null;
        if (item.dest) {
          const destination = typeof item.dest === 'string' ? await document.getDestination(item.dest) : item.dest;
          if (Array.isArray(destination) && destination[0] !== undefined) {
            const target = destination[0];
            const index = typeof target === 'number' ? target : await document.getPageIndex(target);
            if (Number.isInteger(index) && index >= 0 && index < document.numPages) page = index + 1;
          }
        }
        entries.push({ title: item.title, page, children: await convert(item.items ?? []) });
      }
      return entries;
    };
    return convert(await document.getOutline() ?? []);
  }
  async destroy() {
    if (this.lifetime.signal.aborted) return;
    this.lifetime.abort();
    for (const task of this.tasks) task.cancel();
    const destroying = this.loading?.destroy();
    await Promise.allSettled([...this.operations, ...(destroying ? [destroying] : [])]);
    this.pages.clear(); this.texts.clear(); this.tasks.clear();
  }
}

const resources = new Map<string, { resource: PdfResource; users: number }>();
export async function acquirePdfResource(path: string, signal: AbortSignal) {
  const vault = await vaultRequestIdentity();
  assertLive(signal);
  const key = `${vault}\0${path}`;
  let entry = resources.get(key);
  if (!entry) {
    entry = { resource: new PdfResource(path, vault, api.rawUrl(path)), users: 0 };
    resources.set(key, entry);
  }
  entry.users++;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    if (!--entry.users) { resources.delete(key); void entry.resource.destroy(); }
  };
  signal.addEventListener('abort', release, { once: true });
  if (signal.aborted) { release(); throw aborted(); }
  return { resource: entry.resource, release: () => { signal.removeEventListener('abort', release); release(); } };
}
