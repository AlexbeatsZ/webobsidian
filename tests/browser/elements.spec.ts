import { expect, test } from './test';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

async function reset(page: Page, source: string) {
  await page.evaluate(source => window.renderHarness.reset(source), source);
  await page.evaluate(() => window.renderHarness.cursor(0, window.renderHarness.source(0).length));
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('[data-render-pending]')).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/__render-test');
  await page.waitForFunction(() => Boolean(window.renderHarness));
  await page.evaluate(() => { document.querySelector('.theme-light')!.className = 'theme-dark'; });
});

test('elements: table keeps the same native prefix advance as adjacent body text', async ({ page }, info) => {
  for (const [name, prefix, lead] of [
    ['root', '', ''], ['quote', '> ', ''], ['nested', '> > ', '> Outer\n'],
    ['callout', '> ', '> [!info]+ 标题\n'], ['nested-callout', '> > ', '> [!example]+ 外层\n> > [!tip]+ 内层\n'],
    ['list', '    ', '- Parent\n'], ['quoted-list', '>     ', '> - Parent\n'],
  ]) {
    const source = lead + prefix + 'Anchor正文\n' + prefix.trimEnd() + '\n' +
      ['| Name | Value |', '| --- | --- |', '| 甲 | 乙 |'].map(line => prefix + line).join('\n') + '\n\nTail';
    await reset(page, source);
    await expect(page.locator('.cm-table')).toHaveCount(2);
    const rows = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-slot]')].map(host => {
      const line = [...host.querySelectorAll<HTMLElement>('.cm-line')].find(line => line.textContent?.includes('Anchor正文'))!;
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      let node: Node | null; while ((node = walker.nextNode()) && !node.textContent?.includes('Anchor正文')) {}
      const range = document.createRange(); const from = node!.textContent!.indexOf('Anchor正文');
      range.setStart(node!, from); range.setEnd(node!, from + 1);
      return { anchor: range.getBoundingClientRect().left, table: host.querySelector('.cm-table')!.getBoundingClientRect().left };
    }));
    await info.attach(name + '-prefix', { body: JSON.stringify(rows), contentType: 'application/json' });
    for (const row of rows) expect(Math.abs(row.table - row.anchor), name).toBeLessThanOrEqual(.75);
    expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
  }
});

test('elements: polymer table retains its quote inset across fold, edit and reading modes', async ({ page }, info) => {
  const source = readFileSync('tests/fixtures/polymer-callout.md', 'utf8');
  await reset(page, source);
  await page.setViewportSize({ width: 1480, height: 1400 });
  await page.locator('[data-slot]').evaluateAll(hosts => hosts.forEach(host => (host as HTMLElement).style.height = '1250px'));
  for (const slot of [0, 1]) {
    const host = page.locator(`[data-slot="${slot}"]`);
    await expect(host.locator('.cm-table')).toHaveCount(0);
    await host.locator('.cm-callout-fold').click();
    await expect(host.locator('.cm-table tbody tr')).toHaveCount(12);
    const geometry = await host.evaluate(host => {
      const callout = host.querySelector('.md-callout')!;
      const prefix = host.querySelector('.md-callout-body .cm-quote-prefix')!;
      return { frame: callout.getBoundingClientRect().left, prefix: prefix.getBoundingClientRect().width,
        table: host.querySelector('.cm-table')!.getBoundingClientRect().left };
    });
    expect(geometry.table - geometry.frame).toBeCloseTo(geometry.prefix, 0);
  }
  await page.screenshot({ path: info.outputPath('polymer-table.png'), fullPage: true });
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
});

test('elements: Callout icons center on the first title line at multiple font sizes', async ({ page }, info) => {
  for (const size of [18, 24]) {
    const source = ['info', 'example', 'tip', 'warning', 'proof', 'think', 'tactic'].map((type, i) =>
      `> [!${type}]+ ${i % 2 ? '带格式的长标题 '.repeat(15) : '共聚合反应的意义'}\n> 正文`).join('\n\n') + '\n\nTail';
    await reset(page, source);
    await page.addStyleTag({ content: `.cm-content { font-size: ${size}px !important; }` });
    const rows = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.md-callout-title')].map(title => {
      const line = title.querySelector<HTMLElement>('.cm-line')!;
      const svg = title.querySelector('.cm-callout-icon svg')!.getBoundingClientRect();
      const rect = line.getBoundingClientRect(); const height = parseFloat(getComputedStyle(line).lineHeight);
      return { type: title.parentElement!.dataset.callout, difference: (svg.top + svg.bottom) / 2 - rect.top - height / 2 };
    }));
    await info.attach('icon-centers-' + size, { body: JSON.stringify(rows), contentType: 'application/json' });
    for (const row of rows) expect(Math.abs(row.difference), row.type).toBeLessThanOrEqual(.75);
  }
  await page.screenshot({ path: info.outputPath('callout-icons.png'), fullPage: true });
});

test('elements: wide table, image and unbreakable formula expand the Callout with symmetric source insets', async ({ page }, info) => {
  await page.route('**/wide.svg', route => route.fulfill({ contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="90"><rect width="1100" height="90" fill="#557799"/></svg>' }));
  const row = (cells: string[]) => '> | ' + cells.join(' | ') + ' |';
  const table = [row(Array.from({ length: 20 }, (_, i) => '列' + i)), row(Array(20).fill('---')), row(Array(20).fill('WWWW'))].join('\n');
  for (const [name, body, selector] of [
    ['table', table, '.cm-content .cm-table'], ['image', '> ![宽图](/wide.svg)', '.cm-content img.cm-embed-image'],
    ['math', '> $$\\boxed{' + 'x+'.repeat(90) + 'x}$$', '.cm-content .cm-math-body svg'],
  ]) {
    const source = '> [!info]+ 宽内容\n> Anchor正文\n>\n' + body + '\n\nTail';
    await reset(page, source);
    await expect(page.locator(`[data-slot="1"] ${selector}`)).toHaveCount(1);
    if (name === 'image') await page.locator(`[data-slot="1"] ${selector}`).evaluate((img: HTMLImageElement) => img.decode());
    await expect(page.locator('[data-render-pending]')).toHaveCount(0);
    const rows = await page.evaluate(selector => [...document.querySelectorAll('[data-slot]')].map(host => {
      const callout = host.querySelector('.md-callout')!.getBoundingClientRect();
      const item = host.querySelector(selector)!.getBoundingClientRect();
      const prefix = host.querySelector('.md-callout-body .cm-quote-prefix')!.getBoundingClientRect().width;
      return { frameWidth: callout.width, left: item.left - callout.left, right: callout.right - item.right, prefix };
    }), selector);
    await info.attach(name + '-insets', { body: JSON.stringify(rows), contentType: 'application/json' });
    for (const item of rows) {
      expect(item.frameWidth, name).toBeGreaterThan(700);
      expect(item.left, name).toBeGreaterThanOrEqual(item.prefix - 1);
      expect(item.right, name).toBeGreaterThanOrEqual(item.prefix - 1);
      expect(Math.abs(item.left - item.right), name).toBeLessThanOrEqual(2);
    }
    await page.screenshot({ path: info.outputPath('wide-' + name + '.png'), fullPage: true });
    expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
  }
});

test('elements: quoted table cell edit, reorder, source restore and undo share the original document', async ({ page }, info) => {
  const source = '> [!info]+ 表格操作\n>\n> | A | B |\n> | --- | --- |\n> | one | two |\n> | three | four |\n\nTail';
  await reset(page, source);
  const live = page.locator('[data-slot="0"]');
  const reading = page.locator('[data-slot="1"]');
  await live.locator('tbody td').first().click();
  const cell = live.locator('tbody td').first().locator('[contenteditable="true"]');
  await expect(cell).toHaveCount(1);
  await cell.press('Control+a'); await cell.pressSequentially('changed'); await cell.press('Enter');
  await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe(source.replace('one', 'changed'));
  await expect(reading.locator('tbody td').first()).toHaveText('changed');
  await page.evaluate(() => window.renderHarness.undo(0));
  await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe(source);
  await live.locator('.cm-row-handle').first().focus(); await page.keyboard.press('ArrowDown');
  await expect(live.locator('tbody td .cm-table-cell-content').first()).toHaveText('three');
  await page.evaluate(() => window.renderHarness.undo(0));
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
  await live.getByRole('button', { name: '编辑表格源码' }).click();
  await expect(live.locator('.cm-table')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(live.locator('.cm-table')).toHaveCount(1);
  await expect(reading.locator('.cm-row-handle,.cm-col-handle,.cm-table-addrow')).toHaveCount(0);
  const handle = live.locator('.cm-row-handle').first();
  await handle.hover(); const start = (await handle.boundingBox())!;
  const target = (await live.locator('tbody tr').nth(1).boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2); await page.mouse.down();
  await page.mouse.move(target.x + 8, target.y + target.height / 2, { steps: 5 }); await page.mouse.up();
  await expect(live.locator('tbody td .cm-table-cell-content').first()).toHaveText('three');
  await page.evaluate(() => window.renderHarness.undo(0));
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
  await page.screenshot({ path: info.outputPath('table-interactions.png'), fullPage: true });
});

test('elements: all whole-block renderers share quoted origins, mode switches and independent folding', async ({ page }, info) => {
  await page.route('**/small.svg', route => route.fulfill({ contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40"><rect width="100" height="40" fill="#557799"/></svg>' }));
  const source = '> [!info]+ 各种元素\n> Anchor正文 **加粗** ==高亮 $x$== `code` [链接](https://example.com)\n>\n> | 表格 | 数值 |\n> | --- | --- |\n> | 测试 | $x^2$ |\n>\n> $$\n> x^2 + y^2\n> $$\n>\n> ![小图](/small.svg)\n>\n> ---\n>\n> ```js\n> const x = 1;\n> ```\n>\n> ```mermaid\n> graph LR; A-->B\n> ```\n>\n> > [!tip]- 内层\n> > 内层正文\n>\n> <div>HTML正文</div>\n\nTail';
  await reset(page, source);
  for (const slot of [0, 1]) {
    const host = page.locator(`[data-slot="${slot}"] .cm-content`).first();
    await expect(host.locator('.cm-table')).toHaveCount(1);
    await expect(host.locator('.cm-hr-widget hr')).toHaveCount(1);
    await expect(host.locator('.math-block mjx-container')).toHaveCount(1);
    await expect(host.locator('.cm-image-wrap img')).toHaveCount(1);
    await expect(host.locator('.cm-mermaid svg')).toHaveCount(1);
    await expect(host.locator('.cm-html-block')).toContainText('HTML正文');
    expect(await host.locator('.cm-html-block').evaluate(el => el.textContent?.trim().startsWith('>'))).toBe(false);
    await expect(host.locator('.md-code')).toContainText('const x = 1;');
    const prefixes = await host.locator('.cm-prefixed-block').evaluateAll(shells => shells.map(shell => ({
      prefix: shell.firstElementChild!.textContent,
      left: shell.lastElementChild!.getBoundingClientRect().left - shell.getBoundingClientRect().left,
      width: shell.firstElementChild!.getBoundingClientRect().width,
    })));
    expect(prefixes).toHaveLength(4);
    for (const item of prefixes) { expect(item.prefix).toBe('> '); expect(item.left).toBeCloseTo(item.width, 1); }
    const inner = host.locator('.md-callout[data-callout="tip"]');
    await expect(inner).not.toContainText('内层正文'); await inner.locator('.cm-callout-fold').click();
    await expect(inner).toContainText('内层正文');
    const outer = host.locator('.md-callout[data-callout="info"] > .md-callout-title .cm-callout-fold');
    await outer.click(); await expect(host.locator('.cm-table')).toHaveCount(0);
    await outer.click(); await expect(host.locator('.cm-table')).toHaveCount(1);
  }
  await page.evaluate(() => window.renderHarness.mode(0, 'source'));
  await expect(page.locator('[data-slot="0"] .cm-table')).toHaveCount(0);
  await page.evaluate(() => window.renderHarness.mode(0, 'reading'));
  await expect(page.locator('[data-slot="0"] .cm-table')).toHaveCount(1);
  await expect(page.locator('[data-render-pending]')).toHaveCount(0);
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
  await page.screenshot({ path: info.outputPath('element-matrix.png'), fullPage: true });
});
