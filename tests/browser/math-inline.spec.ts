import { test, expect } from './test';
import type { Page } from '@playwright/test';

const tex = String.raw`\ce{M_{\mathit{i}}}`;
function fixture(prefix = '') {
  if (prefix === '- ') return fixture().split('\n').map(line => line ? '- ' + line : '').join('\n');
  return `${prefix}前文位置\n${prefix}\n${prefix}令 $f_i$等于某瞬间单体$${tex}$占单体混合物的摩尔分数,即\n${prefix}\n${prefix}$$f_1=\\frac{[M_1]}{[M_1]+[M_2]}$$\n${prefix}\n${prefix}而$F_i$代表同一瞬间单元占共聚物的摩尔分数\n${prefix}\n${prefix}后文位置`;
}

async function mount(page: Page, source: string, size = 18, theme = 'light') {
  await page.goto('/__render-test');
  await page.waitForFunction(() => Boolean(window.renderHarness));
  await page.evaluate(({ source, size, theme }) => {
    const root = document.querySelector('.theme-light') as HTMLElement;
    root.className = `theme-${theme}`;
    root.style.setProperty('--font-text-size', `${size}px`);
    window.renderHarness.reset(source);
  }, { source, size, theme });
  await expect(page.locator('[data-slot="0"] .cm-content')).toContainText('后文位置');
  await page.evaluate(() => window.renderHarness.cursor(0, window.renderHarness.source(0).length));
  await expect(page.locator('[data-slot="0"] [data-mathjax-version]')).toHaveCount(4);
  await expect(page.locator('[data-render-pending]')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
}

async function geometry(page: Page) {
  return page.evaluate(() => {
    const host = document.querySelector('[data-slot="0"]')!;
    const content = host.querySelector<HTMLElement>('.cm-content')!;
    const scroll = host.querySelector<HTMLElement>('.cm-scroller')!;
    const rect = (node: Element | Range) => {
      const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    const textRect = (text: string) => {
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const from = node.textContent?.indexOf(text) ?? -1;
        if (from < 0) continue;
        const range = document.createRange(); range.setStart(node, from); range.setEnd(node, from + text.length);
        return rect(range);
      }
      throw new Error(`Missing anchor: ${text}`);
    };
    const line = [...content.querySelectorAll('.cm-line')].find(el => el.textContent?.includes('等于某瞬间'))!;
    return { line: rect(line), before: textRect('前文位置'), lead: textRect('令 '),
      after: textRect('后文位置'), block: rect(content.querySelector('.math-block')!),
      content: rect(content), scroll: { x: scroll.scrollLeft, y: scroll.scrollTop },
      sourceItalic: content.querySelector('.cm-math') && getComputedStyle(content.querySelector('.cm-math')!).fontStyle };
  });
}

for (const entry of [
  { name: 'body', prefix: '', size: 18, theme: 'light' },
  { name: 'dark', prefix: '', size: 18, theme: 'dark' },
  { name: 'small', prefix: '', size: 16, theme: 'light' },
  { name: 'large', prefix: '', size: 24, theme: 'dark' },
  { name: 'quote', prefix: '> ', size: 18, theme: 'light' },
  { name: 'nested quote', prefix: '> > ', size: 18, theme: 'dark' },
  { name: 'list', prefix: '- ', size: 18, theme: 'light' },
]) {
  test(`inline source keeps native text metrics: ${entry.name}`, async ({ page }, testInfo) => {
    const source = fixture(entry.prefix);
    await mount(page, source, entry.size, entry.theme);
    // Keep both source and rendered text on one visual line: width changes are
    // intrinsic to TeX and must not be mistaken for a line-metric regression.
    await page.locator('[data-slot="0"]').evaluate(el => (el as HTMLElement).style.width = '1040px');
    await page.addStyleTag({ content: '[data-slot="0"] .cm-content{max-width:none!important}' });
    const baseline = await geometry(page), samples = [];
    if (entry.name === 'body') await testInfo.attach('rendered', { body: await page.locator('[data-slot="0"]').screenshot({ caret: 'hide' }), contentType: 'image/png' });
    const position = source.indexOf(`$${tex}$`) + 3;
    for (let cycle = 0; cycle < 8; cycle++) {
      await page.evaluate(pos => window.renderHarness.cursor(0, pos), position);
      await expect(page.locator('[data-slot="0"] .cm-math')).toContainText(tex);
      const editing = await geometry(page); samples.push(editing);
      if (entry.name === 'body' && cycle === 0) await testInfo.attach('source', { body: await page.locator('[data-slot="0"]').screenshot({ caret: 'hide' }), contentType: 'image/png' });
      for (const key of ['line', 'before', 'lead', 'after', 'block', 'content', 'scroll'] as const) {
        expect(editing[key], `${key}, editing cycle ${cycle}`).toEqual(baseline[key]);
      }
      await page.evaluate(() => window.renderHarness.cursor(0, window.renderHarness.source(0).length));
      await expect(page.locator('[data-slot="0"] .math-inline')).toHaveCount(3);
      await expect(page.locator('[data-render-pending]')).toHaveCount(0);
      const restored = await geometry(page); samples.push(restored);
      for (const key of ['line', 'before', 'lead', 'after', 'block', 'content', 'scroll'] as const) {
        expect(restored[key], `${key}, restored cycle ${cycle}`).toEqual(baseline[key]);
      }
    }
    expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
    await testInfo.attach('geometry', { body: JSON.stringify({ baseline, samples }, null, 2), contentType: 'application/json' });
  });
}

test('inline source clicks preserve a scrolled viewport', async ({ page }, testInfo) => {
  const source = fixture();
  await mount(page, source);
  await page.evaluate(() => window.renderHarness.scroll(0, 30));
  const baseline = await geometry(page);
  const target = page.locator('[data-slot="0"] .math-inline').nth(1);
  await target.click();
  await expect(page.locator('[data-slot="0"] .cm-math')).toContainText(tex);
  const editing = await geometry(page);
  for (const key of ['line', 'before', 'lead', 'after', 'block', 'content', 'scroll'] as const) expect(editing[key]).toEqual(baseline[key]);
  await page.mouse.click(baseline.lead.x + 2, baseline.lead.y + 8);
  await expect(page.locator('[data-slot="0"] .math-inline')).toHaveCount(3);
  const restored = await geometry(page);
  for (const key of ['line', 'before', 'lead', 'after', 'block', 'content', 'scroll'] as const) expect(restored[key]).toEqual(baseline[key]);
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
  await testInfo.attach('mouse-geometry', { body: JSON.stringify({ baseline, editing, restored }, null, 2), contentType: 'application/json' });
});

test('simple formulas keep text baselines in live, source and reading modes', async ({ page }) => {
  const source = '前文位置\n\n令 $f_i$和$t_0$代表当前值\n\n后文位置';
  await page.goto('/__render-test');
  await page.waitForFunction(() => Boolean(window.renderHarness));
  await page.evaluate(s => window.renderHarness.reset(s), source);
  await expect(page.locator('[data-slot="0"] .cm-content')).toContainText('后文位置');
  await page.evaluate(() => window.renderHarness.cursor(0, window.renderHarness.source(0).length));
  await expect(page.locator('[data-slot="0"] .math-inline')).toHaveCount(2);
  await expect(page.locator('[data-render-pending]')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  const positions = () => page.evaluate(() => [...document.querySelectorAll('[data-slot="0"] .cm-line')].map(el => {
    const r = el.getBoundingClientRect(); return { top: r.top, height: r.height };
  }));
  const baseline = await positions();
  for (const mode of ['source', 'reading', 'live', 'source', 'reading'] as const) {
    await page.evaluate(mode => window.renderHarness.mode(0, mode), mode);
    if (mode === 'source') await expect(page.locator('[data-slot="0"] .math-inline')).toHaveCount(0);
    else { await expect(page.locator('[data-slot="0"] .math-inline')).toHaveCount(2); await expect(page.locator('[data-render-pending]')).toHaveCount(0); }
    expect(await positions()).toEqual(baseline);
  }
});

test('tall inline math and long TeX retain their natural height and source', async ({ page }) => {
  const tall = String.raw`\dfrac{\dfrac{a}{b}}{\dfrac{c}{d}}`;
  const source = `前文位置\n\n令 $${tall}$代表当前值\n\n后文位置`;
  await page.goto('/__render-test'); await page.waitForFunction(() => Boolean(window.renderHarness));
  await page.evaluate(s => window.renderHarness.reset(s), source);
  await expect(page.locator('[data-slot="0"] .cm-content')).toContainText('后文位置');
  await page.evaluate(() => window.renderHarness.cursor(0, window.renderHarness.source(0).length));
  await expect(page.locator('[data-slot="0"] .math-inline svg')).toHaveCount(1);
  await expect(page.locator('[data-render-pending]')).toHaveCount(0);
  const measure = () => page.evaluate(() => {
    const line = [...document.querySelectorAll('[data-slot="0"] .cm-line')].find(el => el.textContent?.startsWith('令 '))!;
    const svg = line.querySelector('svg')?.getBoundingClientRect(), r = line.getBoundingClientRect();
    return { height: r.height, lineHeight: parseFloat(getComputedStyle(line).lineHeight), encloses: !svg || (r.top <= svg.top && r.bottom >= svg.bottom) };
  });
  const rendered = await measure(); expect(rendered.height).toBeGreaterThan(rendered.lineHeight); expect(rendered.encloses).toBe(true);
  await page.evaluate(pos => window.renderHarness.cursor(0, pos), source.indexOf(tall) + 1);
  await expect(page.locator('[data-slot="0"] .cm-math')).toContainText(tall);
  const long = 'a+'.repeat(160) + 'b';
  await page.evaluate(({ from, to, insert }) => window.renderHarness.edit(0, [{ from, to, insert }]), { from: source.indexOf(tall), to: source.indexOf(tall) + tall.length, insert: long });
  await expect(page.locator('[data-slot="0"] .cm-math')).toContainText(long);
  const wrapped = await measure(); expect(wrapped.height).toBeGreaterThan(wrapped.lineHeight);
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source.replace(tall, long));
  await page.evaluate(() => window.renderHarness.undo(0));
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
});
