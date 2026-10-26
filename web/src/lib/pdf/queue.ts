export const aborted = () => new DOMException('PDF operation cancelled', 'AbortError');
export function assertLive(signal: AbortSignal): void { if (signal.aborted) throw aborted(); }

export class PdfTaskQueue {
  private running = 0;
  private waiting: { start: () => void; signal: AbortSignal }[] = [];
  constructor(readonly limit: number) {}
  get active() { return this.running; }
  run<Result>(work: () => Promise<Result>, signal: AbortSignal): Promise<Result> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) { reject(aborted()); return; }
      const cancel = () => {
        const index = this.waiting.indexOf(job);
        if (index !== -1) { this.waiting.splice(index, 1); reject(aborted()); }
      };
      const job = { signal, start: () => {
        signal.removeEventListener('abort', cancel);
        if (signal.aborted) { reject(aborted()); this.drain(); return; }
        this.running++;
        void Promise.resolve().then(work).then(resolve, reject).finally(() => { this.running--; this.drain(); });
      } };
      signal.addEventListener('abort', cancel, { once: true });
      this.waiting.push(job);
      this.drain();
    });
  }
  private drain() {
    while (this.running < this.limit && this.waiting.length) this.waiting.shift()!.start();
  }
}

export const pdfRenderQueue = new PdfTaskQueue(2);
export const pdfTextQueue = new PdfTaskQueue(2);
