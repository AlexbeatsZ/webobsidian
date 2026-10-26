import { expect, it } from 'vitest';
import { PdfTaskQueue } from './queue';

it('bounds canvas work at two and removes aborted waiting work before it can start', async () => {
  const queue = new PdfTaskQueue(2), controller = new AbortController();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let started = 0;
  const work = () => queue.run(async () => { started++; await gate; }, new AbortController().signal);
  const first = work(), second = work();
  const waiting = queue.run(async () => { started++; }, controller.signal);
  await Promise.resolve();
  expect(started).toBe(2); expect(queue.active).toBe(2);
  controller.abort();
  await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
  release(); await Promise.all([first, second]);
  expect(started).toBe(2);
});

it('releases a failed task slot and continues queued work', async () => {
  const queue = new PdfTaskQueue(1), signal = new AbortController().signal;
  const first = queue.run(async () => { throw new Error('controlled failure'); }, signal);
  const second = queue.run(async () => 'next', signal);
  await expect(first).rejects.toThrow('controlled failure');
  await expect(second).resolves.toBe('next');
});
