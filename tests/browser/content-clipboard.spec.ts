import type { Page } from '@playwright/test';
import { test, expect } from './test';

const source = '# Title ^heading-original\n\n[[^heading-original|Alias]]\n\n```md\n[[^heading-original]]\n```\n\n';
const mime = 'application/x-webobsidian-content+json';

test.beforeEach(async ({ page }) => {
  await page.goto('/__render-test');
  await page.waitForFunction(() => !!window.renderHarness);
  await page.evaluate(source => window.renderHarness.reset(source, false), source);
  await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe(source);
  await page.evaluate(() => { window.renderHarness.mode(0, 'source'); window.renderHarness.mode(1, 'source'); });
  await expect(page.locator('[data-slot="1"] .cm-content[contenteditable="true"]')).toBeVisible();
});

async function clear(page: Page, slot: number) {
  await page.evaluate(slot => {
    window.renderHarness.edit(slot, [{ from: 0, to: window.renderHarness.source(slot).length, insert: '' }]);
    window.renderHarness.cursor(slot, 0);
  }, slot);
}

async function capture(page: Page, slot: number, mode: 'copy' | 'cut') {
  return page.evaluate(({ slot, mode }) => {
    window.renderHarness.cursor(slot, 0, window.renderHarness.source(slot).length);
    const data = new DataTransfer();
    const event = new ClipboardEvent(mode, { clipboardData: data, bubbles: true, cancelable: true });
    document.querySelector(`[data-slot="${slot}"] .cm-content`)!.dispatchEvent(event);
    return { prevented: event.defaultPrevented, data: Object.fromEntries([...data.types].map(type => [type, data.getData(type)])) };
  }, { slot, mode });
}

async function paste(page: Page, slot: number, content: Record<string, string>) {
  return page.evaluate(({ slot, content }) => {
    window.renderHarness.cursor(slot, window.renderHarness.source(slot).length);
    const data = new DataTransfer();
    for (const [type, value] of Object.entries(content)) data.setData(type, value);
    const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
    document.querySelector(`[data-slot="${slot}"] .cm-content`)!.dispatchEvent(event);
    return { prevented: event.defaultPrevented, source: window.renderHarness.source(slot) };
  }, { slot, content });
}

test('native copy and repeated paste clone IDs and semantic references while retaining code literals', async ({ page }) => {
  await clear(page, 1);
  const clipboard = await capture(page, 0, 'copy');
  expect(clipboard.prevented).toBe(true);
  expect(JSON.parse(clipboard.data[mime]).source).toBe('a.md');
  expect(clipboard.data['text/plain']).toBe(source);
  const first = await paste(page, 1, clipboard.data);
  expect(first.prevented).toBe(true);
  const id = first.source.match(/^# Title \^(heading-[\w-]+)/m)![1];
  expect(id).not.toBe('heading-original');
  expect(first.source).toContain(`[[^${id}|Alias]]`);
  expect(first.source).toContain('```md\n[[^heading-original]]\n```');
  const second = await paste(page, 1, clipboard.data);
  const ids = [...second.source.matchAll(/^# Title \^(heading-[\w-]+)/gm)].map(match => match[1]);
  expect(ids).toHaveLength(2);
  expect(new Set(ids).size).toBe(2);
  expect(ids).not.toContain('heading-original');
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
});

test('native cut moves an identity once and subsequent paste clones it', async ({ page }) => {
  await clear(page, 1);
  const clipboard = await capture(page, 0, 'cut');
  expect(clipboard.prevented).toBe(true);
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe('');
  expect((await paste(page, 1, clipboard.data)).source).toBe(source);
  const repeated = await paste(page, 1, clipboard.data);
  const ids = [...repeated.source.matchAll(/^# Title \^(heading-[\w-]+)/gm)].map(match => match[1]);
  expect(ids[0]).toBe('heading-original');
  expect(ids[1]).not.toBe('heading-original');
});

test('a cut from a closed source view clones instead of trusting its stale source snapshot', async ({ page }) => {
  await clear(page, 0);
  const clipboard = await capture(page, 1, 'cut');
  expect(await page.evaluate(() => window.renderHarness.source(1))).toBe('');
  await page.evaluate(() => window.renderHarness.closeSecondary());
  await expect(page.locator('[data-slot="1"]')).toHaveCount(0);
  const result = await paste(page, 0, clipboard.data);
  expect(result.source).not.toBe(source);
  expect(result.source.match(/^# Title \^(heading-[\w-]+)/m)![1]).not.toBe('heading-original');
});

test('native read-only mutations are blocked and image paste remains available to attachment handlers', async ({ page }) => {
  await page.evaluate(() => window.renderHarness.mode(1, 'reading'));
  await expect(page.locator('[data-slot="1"] .cm-content[contenteditable="true"]')).toHaveCount(0);
  const cut = await capture(page, 1, 'cut');
  expect(cut.prevented).toBe(true);
  expect(await page.evaluate(() => window.renderHarness.source(1))).toBe(source);
  const copied = await capture(page, 0, 'copy');
  expect((await paste(page, 1, copied.data)).source).toBe(source);
  const image = await page.evaluate(() => {
    const data = new DataTransfer();
    data.items.add(new File(['fixture'], 'image.png', { type: 'image/png' }));
    const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
    const slot = document.querySelector('[data-slot="0"]')!;
    let reached = false, files = 0;
    slot.addEventListener('paste', event => {
      reached = true;
      files = (event as ClipboardEvent).clipboardData!.files.length;
      event.preventDefault();
    }, { once: true });
    slot.querySelector('.cm-content')!.dispatchEvent(event);
    return { reached, files, prevented: event.defaultPrevented, source: window.renderHarness.source(0) };
  });
  expect(image.reached).toBe(true);
  expect(image.files).toBe(1);
  expect(image.prevented).toBe(true);
  expect(image.source).toBe(source);
});
