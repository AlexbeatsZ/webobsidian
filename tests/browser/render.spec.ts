import { expect, test } from '@playwright/test';
import type { RenderHarnessApi } from '../../web/src/dev/RenderHarness';

test.beforeEach(async ({ page }) => {
  await page.goto('/__render-test');
  await page.waitForFunction(() => Boolean((window as unknown as { renderHarness: RenderHarnessApi }).renderHarness));
  await expect(page.locator('.cm-editor')).toHaveCount(2);
});

test('unfocused live syntax has the same pixels as reading', async ({ page }) => {
  await page.evaluate(() => {
    const harness = (window as unknown as { renderHarness: RenderHarnessApi }).renderHarness;
    harness.cursor(0, harness.source(0).length);
  });
  await page.evaluate(() => document.fonts.ready);
  const options = { animations: 'disabled' as const, caret: 'hide' as const };
  const live = await page.locator('[data-slot="0"]').screenshot(options);
  const reading = await page.locator('[data-slot="1"]').screenshot(options);
  expect(live.equals(reading)).toBe(true);
});

test('only the caret-owned syntax reveals; a nonempty selection stays rendered', async ({ page }) => {
  await page.evaluate(() => (window as unknown as { renderHarness: RenderHarnessApi }).renderHarness.reset('**one** and **two**\n\nplain'));
  await expect(page.locator('[data-slot="0"] .cm-content')).toContainText('plain');
  await page.evaluate(() => (window as unknown as { renderHarness: RenderHarnessApi }).renderHarness.cursor(0, 24));
  await expect(page.locator('[data-slot="0"] .cm-content')).toContainText('one and two');
  await page.evaluate(() => (window as unknown as { renderHarness: RenderHarnessApi }).renderHarness.cursor(0, 3));
  await expect(page.locator('[data-slot="0"] .cm-content')).toContainText('**one** and two');
  await page.evaluate(() => (window as unknown as { renderHarness: RenderHarnessApi }).renderHarness.cursor(0, 0, 18));
  await expect(page.locator('[data-slot="0"] .cm-content')).toContainText('one and two');
});
