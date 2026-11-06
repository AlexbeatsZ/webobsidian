import { test, expect } from './test';
import { resolve, sep } from 'node:path';
import type { Hotkey } from '../../packages/search-core/src/hotkeys';

test.beforeEach(async ({ page }) => {
  await page.goto('/__render-test');
  await page.waitForFunction(() => !!window.renderHarness);
  await page.evaluate(() => window.renderHarness.reset('first line\n\nlast line'));
  await expect(page.locator('[data-slot="0"] .cm-content')).toContainText('last line');
  await page.evaluate(() => window.renderHarness.focus(0));
});

test('literal Control moves through the document, selects all and uses shared undo/redo', async ({ page }) => {
  const source = 'first line\n\nlast line';
  await page.keyboard.press('Control+End');
  await expect.poll(() => page.evaluate(() => window.renderHarness.location(0)?.anchor)).toBe(source.length);
  await page.keyboard.press('Control+Home');
  await expect.poll(() => page.evaluate(() => window.renderHarness.location(0)?.anchor)).toBe(0);
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText('replacement');
  await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe('replacement');
  await page.keyboard.press('Control+z');
  await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe(source);
  await page.keyboard.press('Control+Shift+Z');
  await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe('replacement');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+y');
  await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe('replacement');
});

test('Control clipboard shortcuts use the source policy and preserve readonly notes', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const source = 'first line\n\nlast line';
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+c');
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(source);
  await page.keyboard.press('Control+x');
  await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe('');
  await page.keyboard.press('Control+v');
  await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe(source);
  await page.evaluate(() => { window.renderHarness.mode(0, 'reading'); window.renderHarness.focus(0); });
  await page.keyboard.press('Control+a'); await page.keyboard.press('Control+x');
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
});

test('clicking the blank scroll area of a short note still places native input at its end', async ({ page }) => {
  const box = await page.locator('[data-slot="0"] .cm-scroller').boundingBox();
  await page.mouse.click(box!.x + 80, box!.y + box!.height - 20);
  await page.keyboard.insertText(' appended');
  await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe('first line\n\nlast line appended');
});

test('physical Option/Alt key events record Alt independently of Command', async ({ page }) => {
  await page.evaluate(async modulePath => {
    const { eventHotkey } = await import(modulePath);
    document.addEventListener('keydown', event => {
      if (event.altKey && event.code === 'KeyZ') {
        event.preventDefault();
        (window as Window & { recordedOptionBinding?: Hotkey }).recordedOptionBinding = eventHotkey(event);
      }
    });
  }, '/@fs/' + resolve('packages/search-core/src/hotkeys.ts').split(sep).join('/'));
  await page.keyboard.press('Alt+z');
  expect(await page.evaluate(() => (window as Window & { recordedOptionBinding?: Hotkey }).recordedOptionBinding)).toEqual({ modifiers: ['Alt'], key: 'Z' });
});
