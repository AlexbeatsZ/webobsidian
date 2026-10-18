import { expect, test } from './test';
import type { RenderHarnessApi } from '../../web/src/dev/RenderHarness';
import { readFileSync } from 'node:fs';

test.beforeEach(async ({ page }) => {
  await page.goto('/__render-test');
  await page.waitForFunction(() => Boolean((window as unknown as { renderHarness: RenderHarnessApi }).renderHarness));
  await expect(page.locator('.cm-editor')).toHaveCount(2);
});

for (const tag of ['<br>', '<br/>', '<br />', '<BR>']) {
  test(`break ${tag} reveals at both inclusive boundaries and restores its visual newline`, async ({ page }) => {
    const raw = `甲${tag}乙\n\nplain`;
    await page.evaluate((source) => (window as unknown as { renderHarness: RenderHarnessApi }).renderHarness.reset(source), raw);
    const live = page.locator('[data-slot="0"] .cm-content');
    const reading = page.locator('[data-slot="1"] .cm-content');
    await expect(live.locator('.cm-html-break')).toHaveCount(1);
    await expect(reading.locator('.cm-html-break')).toHaveCount(1);
    expect(await live.innerText()).toContain('甲\n乙');
    for (let position = 1; position <= 1 + tag.length; position++) {
      await page.evaluate((position) => (window as unknown as { renderHarness: RenderHarnessApi }).renderHarness.cursor(0, position), position);
      await expect(live).toContainText(`甲${tag}乙`);
      await expect(live.locator('.cm-html-break')).toHaveCount(0);
      await expect(reading.locator('.cm-html-break')).toHaveCount(1);
    }
    await page.evaluate((position) => (window as unknown as { renderHarness: RenderHarnessApi }).renderHarness.cursor(0, position), tag.length + 2);
    await expect(live.locator('.cm-html-break')).toHaveCount(1);
    await page.evaluate((position) => (window as unknown as { renderHarness: RenderHarnessApi }).renderHarness.cursor(0, 0, position), tag.length + 2);
    await expect(live.locator('.cm-html-break')).toHaveCount(1);
    expect(await page.evaluate(() => (window as unknown as { renderHarness: RenderHarnessApi }).renderHarness.source(0))).toBe(raw);
  });
}

test('keyboard arrows enter and leave a rendered br without writing source', async ({ page }) => {
  const raw = '甲<br>乙\n\nend';
  await page.evaluate(source => window.renderHarness.reset(source), raw);
  await page.evaluate(() => { window.renderHarness.focus(0); window.renderHarness.cursor(0, 0); });
  const live = page.locator('[data-slot="0"]');
  await page.keyboard.press('ArrowRight');
  await expect(live.locator('.cm-html-break')).toHaveCount(0);
  await expect(live.locator('.cm-content').first()).toContainText('甲<br>乙');
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
  await expect(live.locator('.cm-html-break')).toHaveCount(1);
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(raw);
});

test('simple inline HTML renders text and entities while code remains literal', async ({ page }) => {
  const raw = '<b>甲</b> <kbd>Ctrl</kbd> <mark>乙</mark> &amp; `<br>`\n\nplain';
  await page.evaluate((source) => (window as unknown as { renderHarness: RenderHarnessApi }).renderHarness.reset(source), raw);
  await expect(page.locator('[data-slot="0"] .cm-content')).toContainText('plain');
  await page.evaluate((position) => (window as unknown as { renderHarness: RenderHarnessApi }).renderHarness.cursor(0, position), raw.length);
  const content = page.locator('[data-slot="0"] .cm-content');
  await expect(content.locator('.md-html-b')).toHaveText('甲');
  await expect(content.locator('.md-html-kbd')).toHaveText('Ctrl');
  await expect(content.locator('.md-html-mark')).toHaveText('乙');
  await expect(content.locator('.cm-html-entity')).toHaveText('&');
  await expect(content.locator('.cm-html-break')).toHaveCount(0);
  await expect(content).toContainText('<br>');
});

test('copy across a rendered break returns source and composition freezes reveal', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(() => (window as unknown as { renderHarness: RenderHarnessApi }).renderHarness.reset('甲<br>乙\n\nplain'));
  const content = page.locator('[data-slot="0"] .cm-content');
  await expect(content.locator('.cm-html-break')).toHaveCount(1);
  await content.dispatchEvent('compositionstart', { data: '' });
  await page.evaluate(() => (window as unknown as { renderHarness: RenderHarnessApi }).renderHarness.cursor(0, 2));
  await expect(content.locator('.cm-html-break')).toHaveCount(1);
  await content.dispatchEvent('compositionend', { data: '' });
  await expect(content.locator('.cm-html-break')).toHaveCount(0);
  await page.evaluate(() => {
    const h = (window as unknown as { renderHarness: RenderHarnessApi }).renderHarness;
    h.cursor(0, 0, 6); h.focus(0);
  });
  await expect(content.locator('.cm-html-break')).toHaveCount(1);
  await page.keyboard.press('Control+c');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('甲<br>乙');
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

test('the full syntax fixture stays visually equal through multiple scroll positions', async ({ page }) => {
  const source = readFileSync('tests/fixtures/rendering.md', 'utf8');
  await page.evaluate(source => window.renderHarness.reset(source), source);
  await page.evaluate(() => window.renderHarness.cursor(0, window.renderHarness.source(0).replace(/\r\n|\r/g, '\n').length));
  await expect(page.locator('[data-slot="0"] .cm-table')).toHaveCount(1);
  await expect(page.locator('[data-render-pending]')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(1490, 750);
  for (const top of [0, 500, 1000, 1500]) {
    await page.evaluate(top => { window.renderHarness.scroll(0, top); window.renderHarness.scroll(1, top); }, top);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const options = { animations: 'disabled' as const, caret: 'hide' as const,
      style: '.cm-props-add,.prop-pill-add,.prop-pill-x,.prop-del,.cm-source-toggle{visibility:hidden!important}' };
    const live = await page.locator('[data-slot="0"]').screenshot(options);
    const reading = await page.locator('[data-slot="1"]').screenshot(options);
    expect(live.equals(reading), 'same pixels at scroll ' + top).toBe(true);
  }
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

test('comments and block IDs stay hidden; Unicode tags and reference links share semantics', async ({ page }) => {
  const raw = '#中文标签 %%hidden%%\n\ntext ^block-id\n\n[reference][target] and footnote[^one].\n\n[target]: https://example.com\n[^one]: definition\n\nplain';
  await page.evaluate((source) => (window as unknown as { renderHarness: RenderHarnessApi }).renderHarness.reset(source), raw);
  await expect(page.locator('[data-slot="0"] .cm-content')).toContainText('plain');
  await page.evaluate((position) => (window as unknown as { renderHarness: RenderHarnessApi }).renderHarness.cursor(0, position), raw.length);
  for (const slot of [0, 1]) {
    const content = page.locator(`[data-slot="${slot}"] .cm-content`);
    await expect(content).not.toContainText('hidden');
    await expect(content).not.toContainText('^block-id');
    await expect(content.locator('.cm-hashtag-end')).toHaveText('中文标签');
    await expect(content.locator('.cm-md-link')).toHaveText('reference');
    await expect(content.locator('.cm-footnote-reference')).toHaveText('1');
  }
});

test('table source entry reveals and closes without rewriting source', async ({ page }) => {
  const raw = '| Name | Value |\n| :--- | ---: |\n|  raw  |  spaced  |\n\nplain';
  await page.evaluate((source) => (window as unknown as { renderHarness: RenderHarnessApi }).renderHarness.reset(source), raw);
  const live = page.locator('[data-slot="0"]');
  await expect(live.locator('.cm-table')).toHaveCount(1);
  await live.getByRole('button', { name: 'Edit table source' }).click();
  await expect(live.locator('.cm-table')).toHaveCount(0);
  await expect(live.locator('.cm-content')).toContainText('|  raw  |  spaced  |');
  await live.getByRole('button', { name: 'Close source' }).click();
  await expect(live.locator('.cm-table')).toHaveCount(1);
  expect(await page.evaluate(() => (window as unknown as { renderHarness: RenderHarnessApi }).renderHarness.source(0))).toBe(raw);
});

test('wrapped list text aligns with the list body', async ({ page }) => {
  const raw = '- ' + 'word '.repeat(90) + '\n\nplain';
  await page.evaluate((source) => (window as unknown as { renderHarness: RenderHarnessApi }).renderHarness.reset(source), raw);
  await expect(page.locator('[data-slot="0"] .cm-content')).toContainText('plain');
  await page.evaluate((position) => (window as unknown as { renderHarness: RenderHarnessApi }).renderHarness.cursor(0, position), raw.length);
  const offset = await page.evaluate(() => {
    const h = (window as unknown as { renderHarness: RenderHarnessApi }).renderHarness;
    const first = h.coords(0, 2)!;
    for (let position = 3; position < 300; position++) {
      const next = h.coords(0, position);
      if (next && next.top > first.top + 2) return next.left - first.left;
    }
    throw new Error('Fixture did not wrap');
  });
  expect(Math.abs(offset)).toBeLessThan(2);
});

test('nested callouts own their math and code and fold independently', async ({ page }) => {
  const raw = '> [!note] Outer\n> body\n> > [!warning]- Inner\n> > $$\n> > x^2\n> > $$\n> > ```js\n> > let x = 1\n> > ```\n\nplain';
  await page.evaluate((source) => (window as unknown as { renderHarness: RenderHarnessApi }).renderHarness.reset(source), raw);
  const reading = page.locator('[data-slot="1"]');
  await expect(reading.locator('.md-callout .md-callout')).toHaveCount(1);
  await expect(reading.locator('.katex')).toHaveCount(0);
  await reading.locator('.cm-callout-fold').click();
  await expect(reading.locator('.katex-display')).toHaveCount(1);
  await expect(reading.locator('.md-code')).toContainText('let x = 1');
  await expect(reading.locator('.cm-content')).not.toContainText('> >');
  await reading.locator('.cm-callout-fold').click();
  await expect(reading.locator('.katex')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { renderHarness: RenderHarnessApi }).renderHarness.source(0))).toBe(raw);
});

test('display formula supports source entry without losing multiline source', async ({ page }) => {
  const raw = '$$\n\\frac{a}{b}\n$$\n\nplain';
  await page.evaluate((source) => (window as unknown as { renderHarness: RenderHarnessApi }).renderHarness.reset(source), raw);
  await expect(page.locator('[data-slot="1"] .katex-display')).toHaveCount(1);
  await page.evaluate((position) => (window as unknown as { renderHarness: RenderHarnessApi }).renderHarness.cursor(0, position), raw.length);
  const live = page.locator('[data-slot="0"]');
  await expect(live.locator('.katex-display')).toHaveCount(1);
  await live.getByRole('button', { name: 'Edit formula source' }).click();
  await expect(live.locator('.katex-display')).toHaveCount(0);
  await expect(live.locator('.cm-content')).toContainText('\\frac{a}{b}');
  await live.getByRole('button', { name: 'Close source' }).click();
  await expect(live.locator('.katex-display')).toHaveCount(1);
  expect(await page.evaluate(() => (window as unknown as { renderHarness: RenderHarnessApi }).renderHarness.source(0))).toBe(raw);
});
