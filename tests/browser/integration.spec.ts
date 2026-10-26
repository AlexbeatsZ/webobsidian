import { expect, test } from './test';
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

test('property editing patches one value and preserves mixed newlines, quotes and complex YAML', async ({ page }) => {
  const raw = '\ufeff---\r\ntitle: \'old\' # keep\r\nuntouched: "quoted"\ncomplex:\r\n  nested: [1, 2]\r\n---\r\n\r\nplain';
  await page.evaluate((source) => (window as unknown as { renderHarness: RenderHarnessApi }).renderHarness.reset(source), raw);
  const live = page.locator('[data-slot="0"]');
  await expect(live.locator('.cm-properties .prop-row')).toHaveCount(3);
  const row = live.locator('.prop-row').filter({ hasText: 'title' });
  await row.locator('.prop-val-input').fill('new');
  await live.locator('.cm-line').filter({ hasText: 'plain' }).click();
  expect(await page.evaluate(() => (window as unknown as { renderHarness: RenderHarnessApi }).renderHarness.source(0))).toBe(raw.replace("'old'", "'new'"));
  await expect(page.locator('[data-slot="1"] .prop-row').filter({ hasText: 'title' }).locator('.prop-val-input')).toHaveText('new');
  await expect(live.locator('.prop-row').filter({ hasText: 'complex' }).locator('[contenteditable]')).toHaveCount(0);
  await live.getByRole('button', { name: '编辑属性源码' }).click();
  await expect(live.locator('.cm-properties')).toHaveCount(0);
  await live.locator('.cm-content').press('Escape');
  await expect(live.locator('.cm-properties')).toHaveCount(1);
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(raw.replace("'old'", "'new'"));
});

test('one table cell uses the shared editor and patches only its original token', async ({ page }) => {
  const raw = '\ufeff| **A**  | B |\r\n| :--- | ---: |\n| x\\|y | old |\r\n\r\nend';
  await page.evaluate(source => window.renderHarness.reset(source), raw);
  const live = page.locator('[data-slot="0"]');
  const cell = live.locator('tbody td').nth(1);
  await expect(cell).toHaveText('old');
  await cell.click();
  const input = cell.locator('[contenteditable="true"]');
  await expect(input).toBeFocused();
  await input.press('ControlOrMeta+a');
  await input.pressSequentially('**new**');
  await input.press('Enter');
  await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe(raw.replace('old', '**new**'));
  await expect(page.locator('[data-slot="1"] tbody td').nth(1).locator('.cm-strong')).toHaveText('new');
  await page.evaluate(() => window.renderHarness.undo(0));
  await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe(raw);
});

test('embeds use the shared readonly engine, subscribe to drafts and stop cycles', async ({ page }) => {
  await page.evaluate(() => {
    window.renderHarness.notes({ 'b.md': '# First\n\nskip\n\n# Wanted\n\n**inside**\n\n![[c]]', 'c.md': '![[b]]' });
    window.renderHarness.reset('![[b.md#Wanted]]\n\nend');
  });
  const reading = page.locator('[data-slot="1"]');
  await expect(reading.locator('.cm-note-embed').first()).toContainText('inside');
  await expect(reading).toContainText('循环嵌入：c.md');
  await expect(reading.locator('.cm-note-embed')).toHaveCount(4);
  await expect(reading.locator('.cm-note-embed [contenteditable="true"]')).toHaveCount(0);
  await page.evaluate(() => window.renderHarness.changeNote('b.md', '# Wanted\n\n**changed**'));
  await expect(reading.locator('.cm-note-embed').first()).toContainText('changed');
  await expect(reading).not.toContainText('循环嵌入：');
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe('![[b.md#Wanted]]\n\nend');
});

test('Canvas uses the shared live editor and preserves the surrounding JSON source', async ({ page }) => {
  await page.route('**/api/tags', route => route.fulfill({ json: { tags: [] } }));
  const raw = '\ufeff{\r\n "custom": {"keep":1},\n "nodes": [{"id":"a","type":"text","x":0,"y":0,"width":380,"height":220,"text" : "**old** $x^2$","unknown":7}],\r\n "edges": []\r\n}';
  await page.route('**/api/files/content?path=fixture.canvas', route => route.fulfill({ json: {
    path: 'fixture.canvas', content: raw, revision: 'fixture', vault: 'browser-fixture',
  } }));
  await page.route('**/api/plugins/adapter', route => {
    const { op } = route.request().postDataJSON();
    if (op === 'exists') return route.fulfill({ json: { exists: false } });
    if (op === 'stat') return route.fulfill({ json: { stat: null } });
    if (op === 'list') return route.fulfill({ json: { files: [], folders: [] } });
    return route.fallback();
  });
  await page.evaluate(source => window.renderHarness.canvas(source), raw);
  const card = page.locator('.canvas-node.canvas-text');
  await expect(card.locator('.cm-strong')).toHaveText('old');
  await expect(card.locator('mjx-container[data-mathjax-version="4.1.3"]')).toHaveCount(1);
  await card.dblclick();
  const input = card.locator('[contenteditable="true"]');
  await expect(input).toBeFocused();
  await input.press('ControlOrMeta+a'); await input.pressSequentially('**new**');
  await input.press('Escape');
  await expect.poll(() => page.evaluate(() => window.renderHarness.canvasRaw())).toBe(raw.replace('**old** $x^2$', '**new**'));
  await expect(card.locator('.cm-strong')).toHaveText('new');
});

test('print freezes the entire reading document including content beyond the viewport', async ({ page }) => {
  const source = Array.from({ length: 350 }, (_, i) => `Paragraph ${i} **bold**`).join('\n\n') + '\n\nlast<br>line\n\n$$\nx^2\n$$';
  await page.evaluate(source => window.renderHarness.reset(source), source);
  await page.evaluate(() => window.renderHarness.preparePrint());
  const print = page.frameLocator('.note-print-frame');
  await expect(print.locator('.cm-content').first()).toContainText('Paragraph 349');
  await expect(print.locator('.cm-strong')).toHaveCount(350);
  await expect(print.locator('.cm-gap')).toHaveCount(0);
  await expect(print.locator('mjx-container[jax="SVG"]')).toHaveCount(1);
  await expect(print.locator('#MJX-SVG-styles')).toHaveCount(1);
  expect(await print.locator('mjx-container svg').evaluate(svg => {
    const uses = [...svg.querySelectorAll('use')];
    return uses.length > 0 && uses.every(use => {
    const href = use.getAttribute('href') ?? use.getAttribute('xlink:href');
    return href?.startsWith('#') && Boolean(svg.querySelector(`[id="${href.slice(1)}"]`));
    });
  })).toBe(true);
  await expect(print.locator('.cm-html-break')).toHaveCount(1);
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
});
