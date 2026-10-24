import { expect, test } from './test';
import type { RenderHarnessApi } from '../../web/src/dev/RenderHarness';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { analyzeMarkdown } from '../../packages/markdown-core/src/syntax';
import { footnotes } from '../../packages/markdown-core/src/footnotes';
import { SourceDocument } from '../../packages/markdown-core/src/source';
const { PNG } = require(path.join(path.dirname(require.resolve('playwright-core/package.json')), 'lib/utilsBundle.js'));
// Allow only one 8-bit level of rasterization rounding, never displaced geometry.
function samePixels(a: Buffer, b: Buffer): boolean {
  const left = PNG.sync.read(a), right = PNG.sync.read(b);
  return left.width === right.width && left.height === right.height && left.data.every((value: number, i: number) => Math.abs(value - right.data[i]) <= 1);
}

async function wrappedBodyOffset(page: Page, slot: number) {
  return page.evaluate(slot => {
    const line = document.querySelector(`[data-slot="${slot}"] .HyperMD-list-line`)!;
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node.parentElement?.closest('.cm-list-prefix,.cm-list-fold-anchor') || !node.textContent?.trim()) continue;
      const first = document.createRange(); first.setStart(node, 0); first.setEnd(node, 1);
      const origin = first.getBoundingClientRect();
      for (let i = 1; i < node.textContent.length; i++) {
        if (/\s/.test(node.textContent[i])) continue;
        const range = document.createRange(); range.setStart(node, i); range.setEnd(node, i + 1);
        const rect = range.getBoundingClientRect();
        if (rect.top > origin.top + 2) return Math.abs(rect.left - origin.left);
      }
    }
    throw new Error('Fixture did not wrap');
  }, slot);
}

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
  expect(samePixels(live, reading)).toBe(true);
});

test('shared syntax stays visually equal through multiple scroll positions; footnote projections have separate acceptance', async ({ page }, info) => {
  let source = new SourceDocument(readFileSync('tests/fixtures/rendering.md', 'utf8')).text;
  const notes = footnotes(analyzeMarkdown(source));
  const spans = notes.notes.flatMap(note => note.inline ? note.references : [...note.references, ...note.definitions]).sort((a, b) => b.from - a.from);
  for (const span of spans) source = source.slice(0, span.from) + source.slice(span.to);
  await page.evaluate(source => window.renderHarness.reset(source), source);
  await page.evaluate(() => window.renderHarness.cursor(0, window.renderHarness.source(0).replace(/\r\n|\r/g, '\n').length));
  await expect(page.locator('[data-slot="0"] .cm-table')).toHaveCount(1);
  await expect(page.locator('[data-render-pending]')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(1490, 750);
  for (const top of [0, 500, 1000, 1500]) {
    await page.evaluate(top => { window.renderHarness.scroll(0, top); window.renderHarness.scroll(1, top); }, top);
    await expect(page.locator('[data-render-pending]')).toHaveCount(0);
    await page.evaluate(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); await document.fonts.ready; });
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLElement>('.cm-line[data-list-body-start]')].every(line => line.style.paddingLeft !== ''));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const options = { animations: 'disabled' as const, caret: 'hide' as const,
      style: '.cm-props-add,.prop-pill-add,.prop-pill-x,.prop-del,.cm-source-toggle{visibility:hidden!important}' };
    const live = await page.locator('[data-slot="0"]').screenshot(options);
    const reading = await page.locator('[data-slot="1"]').screenshot(options);
    if (!samePixels(live, reading)) {
      await info.attach('live-' + top, { body: live, contentType: 'image/png' });
      await info.attach('reading-' + top, { body: reading, contentType: 'image/png' });
      await info.attach('geometry-' + top, { body: JSON.stringify(await page.locator('[data-slot]').evaluateAll(hosts => hosts.map(host => ({
        scroll: host.querySelector('.cm-scroller')!.scrollTop,
        lines: [...host.querySelectorAll('.cm-content .cm-line')].map(el => ({ text: el.textContent, top: el.getBoundingClientRect().top, height: el.getBoundingClientRect().height })),
      })))), contentType: 'application/json' });
    }
    expect(samePixels(live, reading), 'same pixels at scroll ' + top).toBe(true);
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
    const content = page.locator(`[data-slot="${slot}"] .cm-content`).first();
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
  await live.getByRole('button', { name: '编辑表格源码' }).click();
  await expect(live.locator('.cm-table')).toHaveCount(0);
  await expect(live.locator('.cm-content')).toContainText('|  raw  |  spaced  |');
  await page.keyboard.press('Escape');
  await expect(live.locator('.cm-table')).toHaveCount(1);
  expect(await page.evaluate(() => (window as unknown as { renderHarness: RenderHarnessApi }).renderHarness.source(0))).toBe(raw);
});

// Prepared regression only: execution remains subject to the static-only boundary.
test('table fragments survive unrelated input and refresh changed equation labels', async ({ page }) => {
  const raw = '| Reference |\n| --- |\n| [[#^eq-a]] |\n\n$$x$$ ^eq-a\n\nplain';
  await page.evaluate(source => { window.renderHarness.reset(source); }, raw);
  const table = page.locator('[data-slot="0"] .cm-table');
  await expect(table).toHaveCount(1);
  await expect(table.locator('.cm-wikilink')).toHaveText('(1-1)');
  const original = await table.elementHandle();
  expect(original).not.toBeNull();
  await page.evaluate(() => {
    const h = window.renderHarness, end = h.source(0).length;
    h.edit(0, [{ from: end, to: end, insert: '!' }]);
  });
  await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe(raw + '!');
  expect(await original!.evaluate(node => node.isConnected)).toBe(true);
  await page.evaluate(() => {
    const h = window.renderHarness, from = h.source(0).indexOf('$$x$$');
    h.edit(0, [{ from, to: from, insert: '$$y$$\n\n' }]);
  });
  await expect(table.locator('.cm-wikilink')).toHaveText('(1-2)');
  expect(await original!.evaluate(node => node.isConnected)).toBe(false);
  await original!.dispose();
});

test('table formulas refresh when an earlier macro changes without moving the table', async ({ page }) => {
  const raw = '$$\\def\\sample{x}$$\n\n| Formula |\n| --- |\n| $\\sample$ |\n\nplain';
  await page.evaluate(source => { window.renderHarness.reset(source); }, raw);
  const table = page.locator('[data-slot="0"] .cm-table');
  await expect(table).toHaveCount(1);
  const original = await table.elementHandle();
  expect(original).not.toBeNull();
  await page.evaluate(() => {
    const h = window.renderHarness, from = h.source(0).indexOf('{x}') + 1;
    h.edit(0, [{ from, to: from + 1, insert: 'y' }]);
  });
  await expect.poll(() => original!.evaluate(node => node.isConnected)).toBe(false);
  await expect(table).toHaveCount(1);
  await original!.dispose();
});

test('wrapped list text aligns with the list body', async ({ page }) => {
  const raw = '- ' + 'word '.repeat(90) + '\n\nplain';
  await page.evaluate((source) => (window as unknown as { renderHarness: RenderHarnessApi }).renderHarness.reset(source), raw);
  await expect(page.locator('[data-slot="0"] .cm-content')).toContainText('plain');
  await page.evaluate((position) => (window as unknown as { renderHarness: RenderHarnessApi }).renderHarness.cursor(0, position), raw.length);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLElement>('.cm-line[data-prefix-layout]')]
    .every(line => line.style.getPropertyValue('--cm-list-prefix-width') !== ''));
  const offset = await wrappedBodyOffset(page, 0);
  expect(Math.abs(offset)).toBeLessThan(2);
});

test('nested callouts own their math and code and fold independently', async ({ page }) => {
  const raw = '> [!note] Outer\n> body\n> > [!warning]- Inner\n> > $$\n> > x^2\n> > $$\n> > ```js\n> > let x = 1\n> > ```\n\nplain';
  await page.evaluate((source) => (window as unknown as { renderHarness: RenderHarnessApi }).renderHarness.reset(source), raw);
  const reading = page.locator('[data-slot="1"]');
  await expect(reading.locator('.md-callout .md-callout')).toHaveCount(1);
  await expect(reading.locator('mjx-container[jax="SVG"]')).toHaveCount(0);
  await reading.locator('.md-callout[data-callout="warning"] .cm-callout-fold').click();
  await expect(reading.locator('mjx-container[jax="SVG"][display="true"]')).toHaveCount(1);
  await expect(reading.locator('.md-code')).toContainText('let x = 1');
  // Prefix source remains native text; concealment changes color, never deletes it.
  for (const prefix of await reading.locator('.cm-quote-prefix,.cm-block-prefix').all())
    await expect(prefix).toHaveCSS('color', 'rgba(0, 0, 0, 0)');
  await reading.locator('.md-callout[data-callout="warning"] .cm-callout-fold').click();
  await expect(reading.locator('mjx-container[jax="SVG"]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { renderHarness: RenderHarnessApi }).renderHarness.source(0))).toBe(raw);
});

test('display formula supports source entry without losing multiline source', async ({ page }) => {
  const raw = '$$\n\\frac{a}{b}\n$$\n\nplain';
  await page.evaluate((source) => (window as unknown as { renderHarness: RenderHarnessApi }).renderHarness.reset(source), raw);
  await expect(page.locator('[data-slot="1"] mjx-container[jax="SVG"][display="true"]')).toHaveCount(1);
  await page.evaluate((position) => (window as unknown as { renderHarness: RenderHarnessApi }).renderHarness.cursor(0, position), raw.length);
  const live = page.locator('[data-slot="0"]');
  await expect(live.locator('mjx-container[jax="SVG"][display="true"]')).toHaveCount(1);
  await live.getByRole('button', { name: '编辑公式源码' }).click();
  // Display source keeps the existing in-document preview while it is edited.
  await expect(live.locator('.cm-math-edit-preview mjx-container[jax="SVG"][display="true"]')).toHaveCount(1);
  await expect(live.locator('.cm-content')).toContainText('\\frac{a}{b}');
  await page.keyboard.press('Escape');
  await expect(live.locator('.cm-math-edit-preview')).toHaveCount(0);
  await expect(live.locator('mjx-container[jax="SVG"][display="true"]')).toHaveCount(1);
  expect(await page.evaluate(() => (window as unknown as { renderHarness: RenderHarnessApi }).renderHarness.source(0))).toBe(raw);
});

test('MathJax 4.1.3 renders inline, display, chemistry and dynamic glyphs with local assets', async ({ page }) => {
  const assets: string[] = [];
  const external: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).origin !== new URL(page.url()).origin) external.push(request.url());
  });
  await page.route('**/assets/mathjax-*/**', async route => {
    assets.push(route.request().url());
    await route.continue();
  });
  // Native writing can initialize MathJax before the test body. Observe the
  // fresh page's complete loader lifecycle rather than only cache misses.
  await page.reload();
  await page.waitForFunction(() => Boolean(window.renderHarness));
  const raw = 'Inline $\\frac{a}{b}$ and $\\ce{2 H2 + O2 -> 2 H2O}$.\n\n$$\n\\begin{aligned} f(x)&=\\int_0^1 x^2\\,dx \\\\ \\mathbb{R}&\\ni x \\end{aligned}\n$$\n\n$\\mathfrak{g} + \\unicode{x1F0A1}$\n\n$\\require{bbm}\\mathbbm{R} + \\require{bboldx}\\mathbb{N} + \\require{dsfont}\\mathds{1}$\n\nend';
  await page.evaluate(source => window.renderHarness.reset(source), raw);
  await page.evaluate(() => window.renderHarness.cursor(0, window.renderHarness.source(0).length));
  for (const slot of [0, 1]) {
    const host = page.locator(`[data-slot="${slot}"]`);
    await expect(host.locator('mjx-container[data-mathjax-version="4.1.3"]')).toHaveCount(5);
    await expect(host.locator('mjx-container[display="true"]')).toHaveCount(1);
    await expect(host.locator('[data-render-pending],[data-mml-node="merror"],.mod-error')).toHaveCount(0);
    await expect(host.locator('mjx-container').first()).toHaveAttribute('aria-label', '\\frac{a}{b}');
  }
  expect(assets.some(url => url.endsWith('/startup.js'))).toBe(true);
  expect(assets.some(url => url.endsWith('/mhchem.js'))).toBe(true);
  expect(assets.some(url => url.includes('/svg/dynamic/'))).toBe(true);
  expect(assets.every(url => new URL(url).origin === new URL(page.url()).origin)).toBe(true);
  expect(external).toEqual([]);
  expect(await page.evaluate(() => document.querySelectorAll('script[src$="/startup.js"]').length)).toBe(1);
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(raw);
});

test('MathJax handles malformed TeX and filters unsafe links without changing source', async ({ page }) => {
  const raw = '$\\frac{$\n\n$\\href{javascript:alert(1)}{unsafe}$\n\nend';
  await page.evaluate(source => window.renderHarness.reset(source), raw);
  const reading = page.locator('[data-slot="1"]');
  await expect(reading.locator('mjx-container')).toHaveCount(2);
  await expect(reading.locator('[data-render-pending]')).toHaveCount(0);
  await expect(reading.locator('[data-mml-node="merror"]')).toHaveCount(1);
  await expect(reading.locator('[href^="javascript:"],[data-mjx-href^="javascript:"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(raw);
});

test('wrapped lists retain measured indentation after asynchronous formula layout', async ({ page }) => {
  const raw = '- ' + 'a long wrapped item '.repeat(20) + '\n\n$$\n\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}\n$$\n\nend';
  await page.evaluate(source => window.renderHarness.reset(source), raw);
  await page.evaluate(() => window.renderHarness.cursor(0, window.renderHarness.source(0).length));
  await expect(page.locator('mjx-container')).toHaveCount(2);
  await expect(page.locator('[data-render-pending]')).toHaveCount(0);
  for (const slot of [0, 1]) {
    await expect.poll(() => wrappedBodyOffset(page, slot)).toBeLessThan(2);
  }
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(raw);
});

test('delayed MathJax conversion cannot repopulate an unmounted formula', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let requested!: () => void;
  const request = new Promise<void>(resolve => { requested = resolve; });
  await page.route('**/assets/mathjax-*/startup.js', async route => {
    requested(); await gate; await route.continue();
  });
  await page.evaluate(() => window.renderHarness.reset('$x^2$\n\nend'));
  await request;
  await page.evaluate(() => window.renderHarness.reset('Replacement\n\nplain'));
  release();
  await page.waitForResponse('**/assets/mathjax-*/ui/safe.js');
  await page.waitForFunction(() => typeof (window as unknown as { MathJax: { tex2svgPromise?: unknown } }).MathJax.tex2svgPromise === 'function');
  await expect(page.locator('.cm-content')).toHaveText(['Replacementplain', 'Replacementplain']);
  await expect(page.locator('mjx-container,[data-render-pending]')).toHaveCount(0);
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe('Replacement\n\nplain');
});
test('default typography loads bundled fonts and shares callout presentation', async ({ page }) => {
  const source = '# Heading\n\n正文 **bold** ==highlight== `code`\n\n> [!proof] Proof\n> Body\n\n> [!think] Think\n> Body\n\n> [!tactic] Tactic\n> Body\n\nend';
  await page.evaluate(source => window.renderHarness.reset(source), source);
  await page.evaluate(() => window.renderHarness.cursor(0, window.renderHarness.source(0).length));
  const fonts = await page.evaluate(async () => {
    return Promise.all(['MathJax_Main', 'MathJax_Math', 'Noto Serif SC', 'Cascadia Code'].map(async family => (await document.fonts.load('18px "' + family + '"')).length));
  });
  expect(fonts.every(count => count > 0)).toBe(true);
  for (const slot of [0, 1]) {
    const host = page.locator(`[data-slot="${slot}"]`);
    await expect(host.locator('.cm-content').first()).toHaveCSS('font-size', '18px');
    await expect(host.locator('.cm-heading-label')).toHaveCount(1);
    for (const kind of ['proof', 'think', 'tactic']) {
      const callout = host.locator(`.md-callout[data-callout="${kind}"]`);
      expect(await callout.evaluate(el => getComputedStyle(el.parentElement!, '::after').boxShadow)).toContain('inset');
      expect(await callout.locator(':scope > .md-callout-title').evaluate(el => getComputedStyle(el, '::before').borderRightWidth)).toBe('3px');
    }
  }
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.querySelector('.theme-light,.theme-dark')!.className = 'theme-' + theme; }, theme);
    const surface = theme === 'dark' ? 'rgb(37, 37, 37)' : 'rgb(250, 250, 250)';
    expect(await page.locator('[data-slot="0"] .md-callout-spacing').first().evaluate(el => getComputedStyle(el, '::after').backgroundColor)).toBe(surface);
    await expect(page.locator('[data-slot="0"] .cm-highlight').first()).toHaveCSS('background-color', theme === 'dark' ? 'rgb(71, 71, 71)' : 'rgb(224, 224, 224)');
    await page.screenshot({ path: test.info().outputPath('theme-' + theme + '.png') });
  }
  await page.evaluate(() => window.renderHarness.cursor(0, 3));
  // The native H1/fold control remains available while the heading text is edited.
  await expect(page.locator('[data-slot="0"] .cm-heading-label')).toHaveCount(1);
  await expect(page.locator('[data-slot="1"] .cm-heading-label')).toHaveCount(1);
});

test('callout title owns its rule and centers the original Lucide icons', async ({ page }) => {
  const raw = '> [!proof]+ 适用条件 **形成与解离**\n> 正文\n\n> [!think]\n> 正文\n\n> [!tactic]- ' + '习题套路与带格式的长标题 '.repeat(12) + '\n> 隐藏的正文\n\nend';
  await page.evaluate(source => window.renderHarness.reset(source), raw);
  await page.evaluate(() => window.renderHarness.cursor(0, window.renderHarness.source(0).length));
  await page.evaluate(() => document.fonts.ready);
  for (const slot of [0, 1]) {
    const host = page.locator(`[data-slot="${slot}"]`);
    for (const [kind, icon] of [['proof', 'check-circle'], ['think', 'lightbulb'], ['tactic', 'file-signature']]) {
      const title = host.locator(`.md-callout[data-callout="${kind}"] > .md-callout-title`);
      await expect(title.locator(`svg[data-lucide="${icon}"]`)).toHaveCount(1);
      const geometry = await title.evaluate(el => {
        const rule = getComputedStyle(el, '::before');
        const rect = el.getBoundingClientRect();
        const svg = el.querySelector('.cm-callout-icon svg')!.getBoundingClientRect();
        const text = [...el.querySelectorAll('.cm-callout-title')].map(node => node.getBoundingClientRect());
        return { top: rule.top, bottom: rule.bottom, width: rule.width, height: parseFloat(rule.height),
          textOffset: (Math.min(...text.map(r => r.top)) + Math.max(...text.map(r => r.bottom)) - rect.top - rect.bottom) / 2,
          titleHeight: rect.height, iconOffset: (svg.top + svg.bottom - rect.top - rect.bottom) / 2,
          lineRule: getComputedStyle(el.querySelector('.cm-line')!, '::before').content };
      });
      expect(geometry.top).toBe('0px'); expect(geometry.bottom).toBe('0px');
      expect(await title.evaluate(el => getComputedStyle(el, '::before').borderRightWidth)).toBe('3px');
      expect(geometry.height).toBeCloseTo(geometry.titleHeight, 1);
      expect(Math.abs(geometry.iconOffset)).toBeLessThan(0.6);
      expect(Math.abs(geometry.textOffset)).toBeLessThan(2);
      expect(geometry.lineRule).toBe('none');
    }
    // The control follows the text rather than sitting between the leading icon and title.
    expect(await host.locator('.md-callout[data-callout="proof"] .cm-line').first().evaluate(el => {
      const text = document.createRange(); text.selectNodeContents(el.querySelector('.cm-strong')!);
      const fold = el.querySelector('.cm-callout-fold')!.getBoundingClientRect();
      return fold.left >= text.getBoundingClientRect().right;
    })).toBe(true);
  }
  const reading = page.locator('[data-slot="1"]');
  const tactic = reading.locator('.md-callout[data-callout="tactic"]');
  await expect(tactic).not.toContainText('隐藏的正文');
  await tactic.locator('.cm-callout-fold').click();
  await expect(tactic).toContainText('隐藏的正文');
  await tactic.locator('.cm-callout-fold').click();
  // Source reveal, edit and undo must keep the CM-owned title editable.
  await page.evaluate(position => window.renderHarness.cursor(0, position), raw.indexOf('适用条件') + 2);
  await page.evaluate(position => window.renderHarness.edit(0, [{ from: position, to: position, insert: '新' }]), raw.indexOf('适用条件') + 2);
  expect(await page.evaluate(() => window.renderHarness.source(0))).toContain('适用新条件');
  await page.evaluate(() => window.renderHarness.undo(0));
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(raw);
  await page.evaluate(() => { window.renderHarness.cursor(0, window.renderHarness.source(0).length); document.querySelector('.theme-light')!.className = 'theme-dark'; });
  await page.screenshot({ path: test.info().outputPath('callout-title-alignment.png') });
});
