import { expect, test } from './test';
import type { Page } from '@playwright/test';

async function reset(page: Page, source: string) {
  await page.evaluate(source => window.renderHarness.reset(source), source);
  await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe(source);
  await page.evaluate(length => window.renderHarness.cursor(0, length), source.length);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLElement>('.cm-line[data-prefix-layout]')]
    .every(line => line.style.getPropertyValue('--cm-quote-prefix-width') !== ''));
}

async function geometry(page: Page) {
  return page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.md-callout-title, .md-quote')].map(title => {
    const line = title.querySelector<HTMLElement>(':scope > .cm-line')!;
    const prefix = line.querySelector<HTMLElement>('.cm-quote-prefix')!;
    const walker = document.createTreeWalker(prefix, NodeFilter.SHOW_TEXT);
    const node = walker.nextNode()!;
    const first = document.createRange(); first.setStart(node, 0); first.setEnd(node, 1);
    const marker = document.createRange();
    marker.setStart(node, prefix.textContent!.lastIndexOf('>'));
    marker.setEnd(node, prefix.textContent!.lastIndexOf('>') + 1);
    const rule = getComputedStyle(title, '::before');
    const icon = title.querySelector<HTMLElement>('.cm-callout-icon');
    const ruleLeft = title.getBoundingClientRect().left + parseFloat(rule.left) + parseFloat(rule.width);
    const own = title.closest<HTMLElement>('.md-callout') ?? title;
    const style = getComputedStyle(title);
    return {
      slot: title.closest('[data-slot]')!.getAttribute('data-slot'),
      type: title.classList.contains('md-quote') ? 'quote' : own.dataset.callout,
      prefix: prefix.textContent, strut: title.dataset.quotePrefix,
      firstLeft: first.getBoundingClientRect().left, markerLeft: marker.getBoundingClientRect().left,
      markerRight: marker.getBoundingClientRect().right,
      frameLeft: own.getBoundingClientRect().left, titleLeft: title.getBoundingClientRect().left,
      ruleLeft, iconGap: icon ? icon.getBoundingClientRect().left - ruleLeft - parseFloat(rule.borderRightWidth) : null,
      ruleWidth: parseFloat(rule.borderRightWidth), padding: style.paddingLeft, display: style.display,
    };
  }));
}

test.beforeEach(async ({ page }) => {
  await page.goto('/__render-test');
  await page.waitForFunction(() => Boolean(window.renderHarness));
  await page.addStyleTag({ content: `
    .callout { padding: 12px 16px; }
    .callout-title { display: flex; padding-left: 12px; margin-bottom: 8px; position: relative; }
    .callout-title::before { content: ''; left: 0; width: 3px; background: currentColor; }
  ` });
  await page.evaluate(() => { document.querySelector('.theme-light')!.className = 'theme-dark'; });
});

test('quote origin: Callout rule follows > and ordinary quote rule precedes > with legacy CSS', async ({ page }, info) => {
  const source = '> [!tip]+ 概率论角度理解理想共聚\n> - **恒比共聚**：超几何分布／二项分布\n>     模型：无偏见抓球。\n\n> 普通引用\n\nTail';
  await reset(page, source);
  const baseline = await geometry(page);
  for (const row of baseline) {
    expect(row.prefix).toBe('> '); expect(row.strut).toBe(row.type === 'quote' ? '' : '>');
    expect(Math.abs(row.firstLeft - row.frameLeft)).toBeLessThanOrEqual(0.25);
    expect(Math.abs(row.type === 'quote' ? row.ruleLeft + row.ruleWidth - row.markerLeft : row.ruleLeft - row.markerRight)).toBeLessThanOrEqual(0.25);
    expect(row.ruleWidth).toBe(3); expect(row.padding).toBe('0px'); expect(row.display).toBe('block');
    if (row.iconGap !== null) expect(row.iconGap).toBeGreaterThanOrEqual(6);
  }
  await page.evaluate(() => window.renderHarness.cursor(0, 0));
  await expect(page.locator('[data-slot="0"] .cm-quote-prefix').first()).toHaveClass(/is-revealed/);
  const revealed = await geometry(page);
  baseline.forEach((row, i) => {
    expect(Math.abs(row.firstLeft - revealed[i].firstLeft)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(row.ruleLeft - revealed[i].ruleLeft)).toBeLessThanOrEqual(0.1);
  });
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
  await info.attach('origin-geometry', { body: JSON.stringify({ baseline, revealed }, null, 2), contentType: 'application/json' });
  await page.evaluate(position => window.renderHarness.cursor(0, position), source.indexOf('> 普通引用'));
  await expect(page.locator('[data-slot="0"] .md-quote .cm-quote-prefix')).toHaveClass(/is-revealed/);
  const plainRevealed = await geometry(page);
  baseline.forEach((row, i) => {
    expect(Math.abs(row.firstLeft - plainRevealed[i].firstLeft)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(row.ruleLeft - plainRevealed[i].ruleLeft)).toBeLessThanOrEqual(0.1);
  });
  await page.screenshot({ path: info.outputPath('quote-origin.png'), fullPage: true });
});

test('quote origin: nesting preserves each raw prefix and limits type color to its own header', async ({ page }, info) => {
  const source = '> [!example]+ 外层示例\n> 外层正文里的 [!warning]+ 是普通文字\n> > [!tip]+ 内层提示\n> > 内层正文\n> > > 普通三级引用\n>\n> 外层结尾\n\nTail';
  await reset(page, source);
  const rows = await geometry(page);
  expect(rows).toHaveLength(6);
  for (const row of rows) {
    expect(Math.abs(row.firstLeft - row.frameLeft)).toBeLessThanOrEqual(0.25);
    expect(Math.abs(row.type === 'quote' ? row.ruleLeft + row.ruleWidth - row.markerLeft : row.ruleLeft - row.markerRight)).toBeLessThanOrEqual(0.25);
    expect(row.prefix).toBe(row.type === 'tip' ? '> > ' : row.type === 'quote' ? '> > > ' : '> ');
    expect(row.strut).toBe(row.type === 'tip' ? '> >' : row.type === 'quote' ? '> > ' : '>');
    if (row.iconGap !== null) expect(row.iconGap).toBeGreaterThanOrEqual(6);
  }
  for (const slot of [0, 1]) {
    const host = page.locator(`[data-slot="${slot}"]`);
    await expect(host.locator('.md-callout[data-callout="warning"]')).toHaveCount(0);
    await expect(host.locator('.md-quote')).toHaveCount(1);
    const colors = await host.evaluate(host => {
      const outer = getComputedStyle(host.querySelector('.md-callout[data-callout="example"] > .md-callout-title')!).color;
      const inner = getComputedStyle(host.querySelector('.md-callout[data-callout="tip"] > .md-callout-title')!).color;
      const body = [...host.querySelectorAll('.cm-line')].find(line => line.textContent === '> > 内层正文')!;
      return { outer, inner, body: getComputedStyle(body).color };
    });
    expect(colors.outer).not.toBe(colors.inner); expect(colors.body).not.toBe(colors.inner);
  }
  await info.attach('nested-geometry', { body: JSON.stringify(rows, null, 2), contentType: 'application/json' });
  await page.screenshot({ path: info.outputPath('quote-nested.png'), fullPage: true });
});

test('quote origin: explicit list whitespace stays distinct and four-space text clears its guide', async ({ page }, info) => {
  const text = '带有推电子取代基的单体往往易与另一带有吸电子取代基的单体发生共聚，并有交替倾向，这种效应称为极性效应。';
  const source = `> [!example]+ 列表间距\n> - 极性效应\n>   ${text}\n>\n> 正文对照。\n\n- 普通列表\n  ${text}\n\n- 四空格\n    ${text}\n\n- Tab缩进\n\t${text}\n\nTail`;
  await reset(page, source);
  const rows = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.HyperMD-list-line')].filter(line => line.querySelector('.cm-indent')).map(line => {
    const prefix = line.querySelector<HTMLElement>('.cm-list-prefix')!;
    const guide = line.querySelector<HTMLElement>('.cm-indent');
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node.textContent?.includes('带')) break;
    }
    const range = document.createRange(); range.setStart(node!, 0); range.setEnd(node!, 1);
    const style = guide && getComputedStyle(guide, '::before');
    const rect = range.getBoundingClientRect();
    const guideRight = guide && guide.getBoundingClientRect().left + parseFloat(style!.marginInlineStart) + parseFloat(style!.width) + parseFloat(style!.borderRightWidth);
    return { slot: line.closest('[data-slot]')!.getAttribute('data-slot'), text: line.textContent,
      prefix: prefix?.textContent, textLeft: rect.left, guideRight, gap: guideRight == null ? null : rect.left - guideRight,
      padding: getComputedStyle(line).paddingLeft, indent: getComputedStyle(line).textIndent,
      prefixWidth: prefix?.getBoundingClientRect().width, guideWidth: guide?.getBoundingClientRect().width };
  }));
  await info.attach('list-guide-geometry', { body: JSON.stringify(rows, null, 2), contentType: 'application/json' });
  await page.screenshot({ path: info.outputPath('quote-list-guides.png'), fullPage: true });
  expect(rows).toHaveLength(8);
  for (const row of rows) {
    expect(['  ', '    ', '\t']).toContain(row.prefix);
    if (row.prefix !== '  ') expect(row.gap, row.text!).toBeGreaterThanOrEqual(6);
  }
  for (const slot of ['0', '1']) {
    const own = rows.filter(row => row.slot === slot);
    expect(own[2].prefixWidth!).toBeGreaterThan(own[1].prefixWidth!);
    expect(own[2].prefixWidth).toBe(own[3].prefixWidth);
  }
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
});

test('quote origin: Backspace on an empty indented list marker preserves the four-space Tab', async ({ page }, info) => {
  await reset(page, '- 测试');
  await page.evaluate(() => { window.renderHarness.cursor(0, 4); window.renderHarness.focus(0); });
  await page.keyboard.press('Enter');
  const entered = await page.evaluate(() => window.renderHarness.source(0));
  await page.keyboard.press('Tab');
  const indented = await page.evaluate(() => window.renderHarness.source(0));
  await page.keyboard.press('Backspace');
  const deleted = await page.evaluate(() => window.renderHarness.source(0));
  await info.attach('list-keyboard-source', { body: JSON.stringify({ entered, indented, deleted }, null, 2), contentType: 'application/json' });
  expect(entered).toBe('- 测试\n- ');
  expect(indented).toBe('- 测试\n    - ');
  expect(deleted).toBe('- 测试\n    ');
  await page.keyboard.insertText('续行正文');
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe('- 测试\n    续行正文');
  for (const slot of [0, 1]) {
    const line = page.locator(`[data-slot="${slot}"] .cm-line`).filter({ hasText: '续行正文' });
    await expect(line.locator('.cm-list-prefix')).toHaveText('    ');
  }
  await page.screenshot({ path: info.outputPath('list-backspace-fixed.png'), fullPage: true });
  for (const [source, expected] of [
    ['- 测试\n\t- ', '- 测试\n\t'],
    ['> - 测试\n>     - ', '> - 测试\n>     '],
    ['1. 测试\n    1. ', '1. 测试\n    '],
  ]) {
    await reset(page, source);
    await page.evaluate(length => { window.renderHarness.cursor(0, length); window.renderHarness.focus(0); }, source.length);
    await page.keyboard.press('Backspace');
    expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(expected);
    expect(await page.evaluate(() => window.renderHarness.source(1))).toBe(expected);
  }
});

test('quote origin: typing Enter after an empty Tip header renders the default title', async ({ page }) => {
  const source = '> [!tip]';
  await reset(page, source);
  await page.evaluate(length => { window.renderHarness.cursor(0, length); window.renderHarness.focus(0); }, source.length);
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe('> [!tip]\n> ');
  for (const slot of [0, 1]) {
    const host = page.locator(`[data-slot="${slot}"]`);
    await expect(host.locator('.md-callout-title .cm-callout-head')).toHaveText(' Tip');
    await expect(host.locator('.cm-quote-prefix')).toHaveCount(2);
  }
});

test('quote origin: table, quoted rules and nested rules render without reinterpreting setext or code', async ({ page }, info) => {
  const source = '> [!info]+ 原子单位\n>\n> | 物理量 | 单位 |\n> | --- | --- |\n> | 长度 | a0 |\n>\n> ---\n>\n> 原子单位下\n> > [!tip]+ 内层\n> > ***\n> > 正文\n\n---\n\nSetext\n---\n\n```markdown\n> ---\n```\n\nTail';
  await reset(page, source);
  for (const slot of [0, 1]) {
    const host = page.locator(`[data-slot="${slot}"]`);
    await expect(host.locator('.cm-table')).toHaveCount(1);
    await expect(host.locator('.cm-hr-widget hr')).toHaveCount(3);
    await expect(host.locator('.md-callout[data-callout="info"] .cm-hr-widget hr')).toHaveCount(2);
    await expect(host.locator('.md-callout[data-callout="tip"] .cm-hr-widget hr')).toHaveCount(1);
    await expect(host.locator('.md-code')).toContainText('> ---');
  }
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
  await page.screenshot({ path: info.outputPath('quote-rules.png'), fullPage: true });
});
