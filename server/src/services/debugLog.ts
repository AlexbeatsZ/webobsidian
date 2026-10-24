import { promises as fs } from 'node:fs';
import path from 'node:path';

/** One local, serialized log with four bounded generations; never writes notes. */
export class DebugLog {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(readonly directory: string, readonly limit = 8 * 1024 * 1024, readonly generations = 4) {}
  private file(index: number) { return path.join(this.directory, `editor-${index}.jsonl`); }
  private run<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work, work); this.queue = result.catch(() => {}); return result;
  }
  append(events: unknown[]): Promise<void> {
    return this.run(async () => {
      const text = events.map(event => JSON.stringify(event) + '\n').join('');
      const bytes = Buffer.byteLength(text);
      if (bytes > this.limit) throw Object.assign(new Error('调试批次过大'), { status: 413 });
      await fs.mkdir(this.directory, { recursive: true });
      let size = 0;
      try { size = (await fs.stat(this.file(0))).size; } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
      if (size + bytes > this.limit) {
        await fs.rm(this.file(this.generations - 1), { force: true });
        for (let i = this.generations - 2; i >= 0; i--) {
          try { await fs.rename(this.file(i), this.file(i + 1)); }
          catch (error: any) { if (error.code !== 'ENOENT') throw error; }
        }
      }
      await fs.appendFile(this.file(0), text, 'utf8');
    });
  }
  read(): Promise<string> {
    return this.run(async () => {
      const parts: string[] = [];
      for (let i = this.generations - 1; i >= 0; i--) {
        try { parts.push(await fs.readFile(this.file(i), 'utf8')); }
        catch (error: any) { if (error.code !== 'ENOENT') throw error; }
      }
      return parts.join('');
    });
  }
  clear(): Promise<void> {
    return this.run(async () => { for (let i = 0; i < this.generations; i++) await fs.rm(this.file(i), { force: true }); });
  }
}
