import { expect, test } from '@playwright/test';
import type { RenderHarnessApi } from '../../web/src/dev/RenderHarness';

test.beforeEach(async ({ page }) => {
  await page.goto('/__render-test');
  await page.waitForFunction(() => Boolean((window as unknown as { renderHarness: RenderHarnessApi }).renderHarness));
  await expect(page.locator('.cm-editor')).toHaveCount(2);
});

test('same-file views share unsaved content and preserve source through save and undo', async ({ page }) => {
  const raw = '\ufeff甲\r\nsecond\nthird\rfourth';
  await page.evaluate((source) => (window as unknown as { renderHarness: RenderHarnessApi }).renderHarness.reset(source), raw);
  await expect(page.locator('[data-slot="0"] .cm-content')).toContainText('second');
  await page.evaluate(() => {
    const h = (window as unknown as { renderHarness: RenderHarnessApi }).renderHarness;
    h.edit(0, [{ from: 2, to: 3, insert: 'S' }]);
  });
  await expect(page.locator('[data-slot="1"] .cm-content')).toContainText('Second');
  expect(await page.evaluate(() => (window as unknown as { renderHarness: RenderHarnessApi }).renderHarness.source(1)))
    .toBe('\ufeff甲\r\nSecond\nthird\rfourth');
  await page.evaluate(async () => {
    const h = (window as unknown as { renderHarness: RenderHarnessApi }).renderHarness;
    await h.save(0); h.undo(0);
  });
  expect(await page.evaluate(() => (window as unknown as { renderHarness: RenderHarnessApi }).renderHarness.source(0))).toBe(raw);
});

test('readonly widgets and direct commands cannot change the document', async ({ page }) => {
  await page.evaluate(() => (window as unknown as { renderHarness: RenderHarnessApi }).renderHarness.reset('- [ ] task\n\nplain'));
  await expect(page.locator('[data-slot="1"] .cm-task-checkbox')).toHaveCount(1);
  await page.locator('[data-slot="1"] .cm-task-checkbox').click();
  await page.evaluate(() => (window as unknown as { renderHarness: RenderHarnessApi }).renderHarness.edit(1, [{ from: 0, to: 0, insert: 'blocked' }]));
  expect(await page.evaluate(() => (window as unknown as { renderHarness: RenderHarnessApi }).renderHarness.source(0))).toBe('- [ ] task\n\nplain');
});

test('different files and unmounting a reader do not steal the command target', async ({ page }) => {
  await page.evaluate(() => (window as unknown as { renderHarness: RenderHarnessApi }).renderHarness.reset('plain', false));
  await expect(page.locator('[data-slot="1"] [data-document-id="b.md"]')).toHaveCount(1);
  await page.evaluate(() => {
    const h = (window as unknown as { renderHarness: RenderHarnessApi }).renderHarness;
    h.focus(0); h.closeSecondary();
  });
  await expect(page.locator('.cm-editor')).toHaveCount(1);
  expect(await page.evaluate(() => (window as unknown as { renderHarness: RenderHarnessApi }).renderHarness.activeDocument())).toBe('a.md');
  await page.evaluate(() => (window as unknown as { renderHarness: RenderHarnessApi }).renderHarness.format('**'));
  expect(await page.evaluate(() => (window as unknown as { renderHarness: RenderHarnessApi }).renderHarness.source(1))).toBe('plain');
});
