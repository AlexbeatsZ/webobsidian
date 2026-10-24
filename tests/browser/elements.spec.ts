import { expect, test } from './test';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { SourceDocument } from '../../packages/markdown-core/src/source';

async function reset(page: Page, source: string) {
  await page.evaluate(source => window.renderHarness.reset(source), source);
  await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe(source);
  await page.evaluate(length => window.renderHarness.cursor(0, length), new SourceDocument(source).text.length);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('[data-render-pending]')).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/__render-test');
  await page.waitForFunction(() => Boolean(window.renderHarness));
  await page.evaluate(() => { document.querySelector('.theme-light')!.className = 'theme-dark'; });
});

test('elements: rendered links stay inside their boxes and native quote/list body inset', async ({ page }, info) => {
  for (const [name, prefix, lead] of [
    ['root', '', ''], ['quote', '> ', ''], ['nested-quote', '> > ', '> Outer\n'],
    ['callout', '> ', '> [!tip]+ 引用中的链接\n'],
    ['nested-callout', '> > ', '> [!example]+ 外层\n> > [!tip]+ 内层\n'],
    ['list', '    ', '- Parent\n'], ['quoted-list', '>     ', '> - Parent\n'],
  ]) {
    const source = lead + [
      'Anchor正文', '详细推导参考[[迭代降低能量]]之后', '[[#全同粒子]]交换后波函数的平方不变',
      '详细推导参考[迭代降低能量](note.md)之后', '[全同粒子](https://example.com)交换后波函数的平方不变',
    ].map(line => prefix + line).join('\n') + '\n\nTail';
    await reset(page, source);
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLElement>('.cm-line[data-prefix-layout]')]
      .every(line => line.style.getPropertyValue('--cm-quote-prefix-width') !== ''));
    const rows = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-slot]')].map(host => {
      const textRect = (node: Node, start: number, end: number) => {
        const range = document.createRange(); range.setStart(node, start); range.setEnd(node, end);
        return range.getBoundingClientRect();
      };
      const anchorLine = [...host.querySelectorAll('.cm-line')].find(line => line.textContent?.includes('Anchor正文'))!;
      const walker = document.createTreeWalker(anchorLine, NodeFilter.SHOW_TEXT);
      let anchorNode: Node | null;
      while ((anchorNode = walker.nextNode()) && !anchorNode.textContent?.includes('Anchor正文')) {}
      const at = anchorNode!.textContent!.indexOf('Anchor正文');
      const anchor = textRect(anchorNode!, at, at + 1).left;
      return [...host.querySelectorAll<HTMLElement>('.cm-wikilink, .cm-md-link')].map(link => {
        const box = link.getBoundingClientRect(), text = link.firstChild!;
        const label = textRect(text, 0, text.textContent!.length);
        // CM surrounds widgets with cursor-buffer elements; adjacent siblings
        // therefore need not be the sentence's real text nodes.
        const texts: Node[] = [], walker = document.createTreeWalker(link.closest('.cm-line')!, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) texts.push(node);
        const before = texts.find(node => node.textContent?.includes('详细推导参考'));
        const after = texts.find(node => /之后|交换后/.test(node.textContent ?? ''));
        const sentenceStart = Boolean(before);
        return { label: link.textContent, indent: getComputedStyle(link).textIndent,
          inside: label.left - box.left, body: label.left - anchor, sentenceStart,
          beforeGap: sentenceStart ? label.left - textRect(before!, 0, before!.textContent!.length).right : null,
          afterGap: after?.textContent
            ? textRect(after, 0, 1).left - label.right : null };
      });
    }));
    await info.attach(name + '-link-geometry', { body: JSON.stringify(rows), contentType: 'application/json' });
    for (const links of rows) {
      expect(links).toHaveLength(4);
      for (const link of links) {
        expect.soft(link.inside, name + ' label stays inside link box').toBeGreaterThanOrEqual(-.75);
        if (!link.sentenceStart) expect.soft(Math.abs(link.body), name + ' line-start body alignment').toBeLessThanOrEqual(.75);
        if (link.beforeGap !== null) expect.soft(link.beforeGap, name + ' no preceding-text overlap').toBeGreaterThanOrEqual(-.75);
        if (link.afterGap !== null) expect.soft(link.afterGap, name + ' no following-text overlap').toBeGreaterThanOrEqual(-.75);
      }
    }
    expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
    expect(await page.evaluate(() => window.renderHarness.source(1))).toBe(source);
  }
  await page.screenshot({ path: info.outputPath('quoted-list-links.png'), fullPage: true });
});

test('elements: quoted links beside formulas retain source reveal, native input, undo and navigation', async ({ page }, info) => {
  const source = '> [!tip]+ 迭代波函数的理解\n> 每次迭代计算波函数$\\psi_j^{(k)}$,得到$\\psi_j^{(k+1)}$\n' +
    '> 详细推导参考[[迭代降低能量]]\n> $$\\bar V=\\iint |\\Psi(1,2)|^2 \\frac{1}{r_{12}}\\,d\\tau$$\n' +
    '> [[#全同粒子]]交换后,波函数的平方不变\n\nTail';
  await reset(page, source);
  const live = page.locator('[data-slot="0"]'), reading = page.locator('[data-slot="1"]');
  await expect(live.locator('.cm-wikilink')).toHaveCount(2);
  await expect(live.locator('[data-mathjax-version]')).toHaveCount(3);
  const point = await live.locator('.md-callout-body .cm-line').filter({ hasText: '交换后' }).evaluate(line => {
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.textContent!.indexOf('交换后'); if (at < 0) continue;
      const range = document.createRange(); range.setStart(node, at); range.setEnd(node, at + 1);
      const rect = range.getBoundingClientRect(); return { x: rect.left + 1, y: (rect.top + rect.bottom) / 2 };
    }
    throw new Error('Missing native text after the link');
  });
  await page.mouse.click(point.x, point.y);
  await page.keyboard.insertText('新');
  const at = source.indexOf('交换后');
  await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe(source.slice(0, at) + '新' + source.slice(at));
  await page.keyboard.press('Control+z');
  await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe(source);
  await page.evaluate(pos => window.renderHarness.cursor(0, pos), source.indexOf('[[迭代降低能量]]') + 3);
  await expect(live.locator('.cm-wikilink')).toHaveCount(1);
  await expect(live.locator('.cm-content')).toContainText('[[迭代降低能量]]');
  await expect(reading.locator('.cm-wikilink')).toHaveCount(2);
  await page.evaluate(() => window.renderHarness.cursor(0, window.renderHarness.source(0).length));
  await expect(live.locator('.cm-wikilink')).toHaveCount(2);
  await reading.locator('.cm-wikilink').first().click();
  expect(await page.evaluate(() => window.renderHarness.links)).toEqual(['1:迭代降低能量']);
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
  expect(await page.evaluate(() => window.renderHarness.source(1))).toBe(source);
  await page.screenshot({ path: info.outputPath('formula-callout-links.png'), fullPage: true });
});

test('elements: one source-line indent rule isolates every nested inline presentation', async ({ page }, info) => {
  await page.route('**/inline-layout.svg', route => route.fulfill({ contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="24"><rect width="48" height="24" fill="#557799"/></svg>' }));
  const source = '> [!tip]+ 行布局归属\n> - **bold text** and *emphasis text*, [[目标|内部链接]], [外部链接](https://example.com), `code`, <kbd>Ctrl</kbd>, $x_i$, ![图](/inline-layout.svg)\n' +
    '>     后续原生正文\n>     ' + '足够长的续行正文用于检查悬挂换行对齐'.repeat(8) + '\n\nTail';
  await reset(page, source);
  await expect(page.locator('.cm-strong')).toHaveCount(2);
  await expect(page.locator('.cm-em')).toHaveCount(2);
  await expect(page.locator('.cm-wikilink,.cm-md-link')).toHaveCount(4);
  await expect(page.locator('img.cm-embed-image')).toHaveCount(2);
  await page.locator('img.cm-embed-image').evaluateAll(images => Promise.all(images.map(image => (image as HTMLImageElement).decode())));
  for (const size of [18, 24]) {
    const style = await page.addStyleTag({ content: `.cm-content{font-size:${size}px!important}` });
    await expect.poll(() => page.locator('.cm-quote-prefix').first().evaluate(prefix => prefix.getBoundingClientRect().width)).toBeGreaterThan(0);
    const rows = await page.locator('.cm-line[data-prefix-layout]').evaluateAll(lines => lines.map(line => ({
      lineIndent: getComputedStyle(line).textIndent,
      presentations: [...line.querySelectorAll<HTMLElement>('*')]
        .filter(el => el.closest('.cm-line') === line && !el.closest('svg'))
        .map(el => ({ class: el.className, indent: getComputedStyle(el).textIndent })),
    })));
    await info.attach('all-inline-presentations-' + size, { body: JSON.stringify(rows), contentType: 'application/json' });
    expect(rows.some(row => parseFloat(row.lineIndent) < 0)).toBe(true);
    for (const row of rows) for (const presentation of row.presentations) expect(presentation.indent, presentation.class).toBe('0px');
    const links = await page.locator('.cm-wikilink,.cm-md-link').evaluateAll(links => links.map(link => {
      const range = document.createRange(); range.setStart(link.firstChild!, 0); range.setEnd(link.firstChild!, link.firstChild!.textContent!.length);
      return range.getBoundingClientRect().left - link.getBoundingClientRect().left;
    }));
    for (const inset of links) expect(inset).toBe(0);
    await style.evaluate(style => style.remove());
  }
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
  await page.screenshot({ path: info.outputPath('unified-inline-layout.png'), fullPage: true });
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

test('elements: Callout icons center between the rule and aligned multiline title text', async ({ page }, info) => {
  for (const size of [18, 24]) {
    const source = ['info', 'example', 'tip', 'warning', 'proof', 'think', 'tactic'].map((type, i) =>
      `> [!${type}]+ ${i % 2 ? '带格式的长标题 '.repeat(15) : '共聚合反应的意义'}\n> 正文`).join('\n\n') + '\n\nTail';
    await reset(page, source);
    await page.addStyleTag({ content: `.cm-content { font-size: ${size}px !important; }` });
    const rows = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.md-callout-title')].map(title => {
      const line = title.querySelector<HTMLElement>('.cm-line')!;
      const svg = title.querySelector('.cm-callout-icon svg')!.getBoundingClientRect();
      const rect = line.getBoundingClientRect();
      const caption = title.querySelector('.cm-callout-title')!;
      const text: DOMRect[] = [];
      const walker = document.createTreeWalker(caption, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.parentElement?.closest('.cm-callout-fold')) continue;
        for (let i = 0; i < node.textContent!.length; i++) {
          if (!node.textContent![i].trim()) continue;
          const range = document.createRange(); range.setStart(node, i); range.setEnd(node, i + 1);
          text.push(range.getBoundingClientRect());
        }
      }
      const lefts = new Map<number, number>();
      for (const rect of text) lefts.set(rect.top, Math.min(lefts.get(rect.top) ?? Infinity, rect.left));
      const rule = getComputedStyle(title, '::before');
      const ruleCenter = title.getBoundingClientRect().left + parseFloat(rule.width) + parseFloat(rule.borderRightWidth) / 2;
      return { type: title.parentElement!.dataset.callout, lines: lefts.size,
        difference: (svg.top + svg.bottom) / 2 - (rect.top + rect.bottom) / 2,
        horizontal: (svg.left + svg.right) / 2 - (ruleCenter + text[0].left) / 2,
        wrapError: Math.max(...lefts.values()) - Math.min(...lefts.values()) };
    }));
    await info.attach('icon-centers-' + size, { body: JSON.stringify(rows), contentType: 'application/json' });
    await info.attach('title-dom-' + size, { body: await page.locator('[data-slot="0"] .md-callout-title').nth(1).evaluate(el => el.outerHTML), contentType: 'text/html' });
    for (const row of rows) {
      expect(Math.abs(row.difference), row.type + ' vertical').toBeLessThanOrEqual(.75);
      expect(Math.abs(row.horizontal), row.type + ' horizontal').toBeLessThanOrEqual(.75);
      expect(row.wrapError, row.type + ' wraps').toBeLessThanOrEqual(.75);
    }
    expect(rows.some(row => row.lines >= 3)).toBe(true);
  }
  await page.screenshot({ path: info.outputPath('callout-icons.png'), fullPage: true });
});

test('elements: wrapped Callout titles keep native second-line click, input, reveal and undo', async ({ page }, info) => {
  const title = '在大聚合度假定下,上述过程的本质是齐次马尔可夫链,Mayo-Lewis 算的齐次马尔科夫链的平稳分布';
  const source = `> [!tip]+ ${title}\n> 正文\n\n> [!example]+ 外层 **${title}**\n> > [!tip]+   ${title}\n> > 内层正文\n\n> [!think]\n> 默认标题\n\nTail`;
  await reset(page, source);
  const live = page.locator('[data-slot="0"]');
  const point = await live.locator('.md-callout[data-callout="tip"] > .md-callout-title').first().evaluate(el => {
    const caption = el.querySelector('.cm-callout-title')!;
    const walker = document.createTreeWalker(caption, NodeFilter.SHOW_TEXT);
    let firstTop: number | undefined, offset = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement?.closest('.cm-callout-fold')) continue;
      for (let i = 0; i < node.textContent!.length; i++) {
        const range = document.createRange(); range.setStart(node, i); range.setEnd(node, i + 1);
        const rect = range.getBoundingClientRect(); firstTop ??= rect.top;
        if (rect.top > firstTop + 10) return { x: rect.left + 1, y: (rect.top + rect.bottom) / 2, offset: offset + i };
      }
      offset += node.textContent!.length;
    }
    throw new Error('The actual two-line title must wrap');
  });
  await page.screenshot({ path: info.outputPath('two-line-title.png'), fullPage: true });
  await page.mouse.click(point.x, point.y);
  await page.keyboard.insertText('新');
  const at = source.indexOf(title) + point.offset;
  await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe(source.slice(0, at) + '新' + source.slice(at));
  await page.keyboard.press('Control+z');
  await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe(source);
  await page.evaluate(() => window.renderHarness.cursor(0, 3));
  await expect(live.locator('.cm-callout-heading')).toHaveCount(3);
  await expect(live.locator('.cm-callout-icon')).toHaveCount(3);
  await page.evaluate(() => window.renderHarness.cursor(0, window.renderHarness.source(0).length));
  await expect(live.locator('.cm-callout-heading')).toHaveCount(4);
  await expect(live.locator('.cm-strong')).toHaveCount(1);
  for (const slot of [0, 1]) {
    const rows = await page.locator(`[data-slot="${slot}"] .md-callout-title`).evaluateAll(titles => titles.map(title => {
      const caption = title.querySelector('.cm-callout-title')!.getBoundingClientRect();
      const svg = title.querySelector('.cm-callout-icon svg')!.getBoundingClientRect();
      const rule = getComputedStyle(title, '::before');
      const left = title.getBoundingClientRect().left + parseFloat(rule.width) + parseFloat(rule.borderRightWidth) / 2;
      return { y: (svg.top + svg.bottom - caption.top - caption.bottom) / 2,
        x: (svg.left + svg.right - left - caption.left) / 2 };
    }));
    await info.attach('nested-formatted-default-' + slot, { body: JSON.stringify(rows), contentType: 'application/json' });
    for (const row of rows) { expect(Math.abs(row.x)).toBeLessThanOrEqual(.75); expect(Math.abs(row.y)).toBeLessThanOrEqual(.75); }
  }
  expect(await page.evaluate(() => window.renderHarness.source(1))).toBe(source);
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

test('elements: nested frames follow enclosing body insets without shifting native text', async ({ page }, info) => {
  const source = '> [!example]+ 外层\n> Outer正文\n> > [!tip]+ 内层\n> > Inner正文\n> > > [!warning]+ 第三层\n> > > Third正文\n> > >\n> > > | A | B |\n> > > | --- | --- |\n> > > | one | two |\n\nTail';
  await reset(page, source);
  const rows = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.md-callout-spacing')].map(frame => {
    const rect = frame.getBoundingClientRect();
    const inset = parseFloat(getComputedStyle(frame).gridTemplateColumns);
    const parent = frame.parentElement!.closest<HTMLElement>('.md-callout-spacing');
    const parentRect = parent?.getBoundingClientRect();
    const parentInset = parent ? parseFloat(getComputedStyle(parent).gridTemplateColumns) : 0;
    const line = frame.querySelector('.md-callout-body .cm-line')!;
    const prefix = line.querySelector('.cm-quote-prefix')!.getBoundingClientRect();
    return { prefix: frame.dataset.calloutParentPrefix, inset,
      left: parentRect ? rect.left + inset - parentRect.left - parentInset : 0,
      right: parentRect ? parentRect.right - rect.right : 0,
      textLeft: prefix.right - rect.left - inset,
      sourceLeft: prefix.left - rect.left };
  }));
  await info.attach('nested-frame-insets', { body: JSON.stringify(rows), contentType: 'application/json' });
  expect(rows).toHaveLength(6);
  for (const row of rows) {
    expect(row.sourceLeft).toBeCloseTo(0, 1);
    expect(row.textLeft).toBeGreaterThan(10);
    if (row.prefix) { expect(row.left).toBeGreaterThan(10); expect(Math.abs(row.left - row.right)).toBeLessThanOrEqual(.75); }
    else expect(row.inset).toBe(0);
  }
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
  await page.screenshot({ path: info.outputPath('nested-frames.png'), fullPage: true });
});

test('elements: gradual keyboard typing keeps Callout headers, continuation and deletion current', async ({ page }, info) => {
  const snapshots: { step: string; source: string }[] = [];
  for (const delay of [25, 0]) {
    await reset(page, '');
    await page.evaluate(() => window.renderHarness.focus(0));
    for (const ch of '> [!tip]') {
      await page.keyboard.type(ch, { delay });
      snapshots.push({ step: 'header-' + delay + '-' + ch, source: await page.evaluate(() => window.renderHarness.source(0)) });
    }
    await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe('> [!tip]');
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe('> [!tip]\n> ');
    await expect(page.locator('[data-slot="0"] .md-callout-title .cm-callout-icon')).toHaveCount(1);
    let text = '';
    for (const ch of 'nnsdfjk') {
      text += ch; await page.keyboard.type(ch, { delay });
      await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe('> [!tip]\n> ' + text);
      await expect(page.locator('[data-slot="0"] .md-callout-body .cm-quote-prefix')).toHaveText('> ');
    }
    await page.keyboard.press('Enter');
    await page.keyboard.type('> [!warning]+ Nested', { delay });
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe('> [!tip]\n> nnsdfjk\n> > [!warning]+ Nested\n> > ');
    await page.keyboard.type('inside', { delay });
    await expect(page.locator('[data-slot="0"] .md-callout[data-callout="warning"] .md-callout-body')).toContainText('inside');
    await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
    snapshots.push({ step: 'leave-inner-' + delay, source: await page.evaluate(() => window.renderHarness.source(0)) });
    await page.keyboard.type('after', { delay });
    await page.keyboard.press('Control+a'); await page.keyboard.press('Backspace');
    await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe('');
    await expect(page.locator('.md-callout,.md-callout-spacing,.cm-callout-icon')).toHaveCount(0);
    await page.keyboard.press('Control+z');
    await expect(page.locator('[data-slot="0"] .md-callout[data-callout="tip"]')).toHaveCount(1);
    await info.attach('typing-' + delay, { body: JSON.stringify(snapshots), contentType: 'application/json' });
  }
  await page.screenshot({ path: info.outputPath('gradual-input.png'), fullPage: true });
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
