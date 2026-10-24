import { test, expect } from './test';
import type { Page } from '@playwright/test';

async function mount(page: Page, source: string) {
  await page.goto('/__render-test');
  await page.waitForFunction(() => Boolean(window.renderHarness));
  await page.evaluate(source => window.renderHarness.reset(source), source);
  await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe(source);
  await page.evaluate(() => window.renderHarness.cursor(0, window.renderHarness.source(0).length));
  await expect(page.locator('[data-render-pending]')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
}

/** Verify the font that painted glyphs, not just a declared CSS fallback list. */
async function paintedFonts(page: Page, slot: number) {
  const probes = await page.evaluate(slot => {
    const body = document.querySelector<HTMLElement>(`[data-slot="${slot}"] .cm-content > .cm-line`)!;
    const nodes = [body, ...document.querySelectorAll<SVGTextElement>(`[data-slot="${slot}"] svg text`)]
      .filter(node => /[\u3400-\u9fff]/.test(node.textContent ?? ''));
    return nodes.map((node, i) => {
      node.setAttribute('data-font-probe', String(i));
      return { selector: `[data-slot="${slot}"] [data-font-probe="${i}"]`, text: node.textContent,
        family: getComputedStyle(node).fontFamily };
    });
  }, slot);
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument');
    const result = [];
    for (const probe of probes) {
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: probe.selector });
      const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
      result.push({ ...probe, fonts: fonts.map(font => ({ family: font.familyName, custom: font.isCustomFont, glyphs: font.glyphCount })) });
    }
    return result;
  } finally { await cdp.detach(); }
}

test('formula Chinese uses the same bundled fallback font as body text in both views', async ({ page }, info) => {
  const source = '外部中文正文\n\n直接中文 $中文$\n\n普通文本 $\\text{中文正文}$\n\n粗体 $\\textbf{中文粗体}$\n\n' +
    '> [!info]+ 中文字体\n> $$x+\\text{中文标签}+\\mathrm{中文}$$\n\nTail';
  await mount(page, source);
  await expect(page.locator('[data-slot="1"] [data-mathjax-version]')).toHaveCount(4);
  for (const slot of [0, 1]) {
    const rows = await paintedFonts(page, slot);
    await info.attach('painted-chinese-fonts-' + slot, { body: JSON.stringify(rows), contentType: 'application/json' });
    expect(rows.length).toBeGreaterThan(4);
    const bodyFonts = rows[0].fonts.map(font => font.family);
    expect(bodyFonts.some(family => /Noto Serif SC/i.test(family))).toBe(true);
    for (const row of rows.slice(1)) {
      expect(row.fonts.some(font => bodyFonts.includes(font.family)), row.text ?? '').toBe(true);
    }
  }
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
  await page.screenshot({ path: info.outputPath('formula-chinese-fonts.png'), fullPage: true });
});

test('formula text metrics and cached SVG follow the effective body font family', async ({ page }, info) => {
  const source = '外部中文正文 Text123\n\n公式 $\\text{中文 Text123}+x_i$\n\n$$\\text{中文 Text123}+x_i$$\n\nTail';
  await mount(page, source);
  const capture = () => page.locator('[data-slot="1"] .cm-math-body').evaluateAll(bodies => bodies.map(body => {
    const text = body.querySelector('svg [data-mml-node="mtext"] text')!;
    const svg = body.querySelector('svg')!;
    return { family: getComputedStyle(text).fontFamily, textWidth: text.getBoundingClientRect().width,
      viewBox: svg.getAttribute('viewBox'), mathPaths: svg.querySelectorAll('path').length };
  }));
  const initial = await capture();
  const style = await page.addStyleTag({ content: ':root{--font-text:"Noto Serif SC",serif}' });
  // Reopen the same source under another effective font. Equal TeX/size/width
  // must not retrieve SVG metrics cached for the previous host's font family.
  await page.evaluate(source => window.renderHarness.reset(source), source);
  await expect.poll(async () => (await capture()).every(row => row.family.startsWith('"Noto Serif SC"'))).toBe(true);
  await page.evaluate(() => document.fonts.ready);
  const changed = await capture();
  for (let i = 0; i < changed.length; i++) {
    expect(Math.abs(changed[i].textWidth - initial[i].textWidth)).toBeGreaterThan(.5);
    expect(changed[i].viewBox).not.toBe(initial[i].viewBox);
    expect(changed[i].mathPaths).toBeGreaterThan(0);
  }
  await page.evaluate(source => window.renderHarness.reset(source), source);
  await expect(page.locator('[data-render-pending]')).toHaveCount(0);
  await expect.poll(capture).toEqual(changed);
  await style.evaluate(style => style.remove());
  await page.evaluate(source => window.renderHarness.reset(source), source);
  await expect.poll(capture).toEqual(initial);
  await info.attach('font-family-cache-metrics', { body: JSON.stringify({ initial, changed }), contentType: 'application/json' });
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
});

test('formula previews, native and explicit numbers and print use the body fallback chain', async ({ page }, info) => {
  const source = '外部中文正文\n\n行内 $\\text{预览中文}+x$\n\n$$\\text{块中文}+x$$ ^eq-font\n\n' +
    '$$x\\tag{中文编号}$$\n\nTail';
  await mount(page, source);
  const reading = page.locator('[data-slot="1"]');
  await expect(reading.locator('.cm-equation-number')).toHaveCount(1);
  const family = await reading.locator('.cm-content').evaluate(el => getComputedStyle(el).fontFamily);
  expect(await reading.locator('.cm-equation-number').evaluate(el => getComputedStyle(el).fontFamily)).toBe(family);
  const explicit = reading.locator('svg text').filter({ hasText: '中文编号' });
  await expect(explicit).toHaveCount(1);
  expect(await explicit.evaluate(el => getComputedStyle(el).fontFamily)).toBe(family);
  await page.evaluate(pos => window.renderHarness.cursor(0, pos), source.indexOf('\\text{预览中文}') + 5);
  const tooltip = page.locator('.cm-tooltip-cursor svg text').filter({ hasText: '预览中文' });
  await expect(tooltip).toHaveCount(1);
  expect(await tooltip.evaluate(el => getComputedStyle(el).fontFamily)).toBe(family);
  await page.screenshot({ path: info.outputPath('formula-font-preview.png'), fullPage: true });
  await page.evaluate(() => window.renderHarness.preparePrint());
  const print = page.frameLocator('iframe.note-print-frame');
  await expect(print.locator('svg text').filter({ hasText: '块中文' })).toHaveCount(1);
  const printed = await print.locator('svg text').evaluateAll(texts => texts
    .filter(text => /[\u3400-\u9fff]/.test(text.textContent ?? ''))
    .map(text => ({ text: text.textContent, family: getComputedStyle(text).fontFamily })));
  await info.attach('print-text-fonts', { body: JSON.stringify(printed), contentType: 'application/json' });
  expect(printed.length).toBeGreaterThan(2);
  for (const row of printed) expect(row.family).toBe(family);
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
});

test('code keeps bundled Cascadia monospace and uses bundled Noto Sans SC for Chinese', async ({ page }, info) => {
  const source = '外部中文正文\n\n公式 $\\text{公式中文}+x_i$\n\n`iiii WWWW 中文`\n\n```text\niiii WWWW 中文\n```\n\n> ```text\n> iiii WWWW 中文\n> ```\n\nTail';
  await mount(page, source);
  const cdp = await page.context().newCDPSession(page);
  const samples = [];
  try {
    await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
    for (const slot of [0, 1]) {
      const code = page.locator(`[data-slot="${slot}"] .cm-code,[data-slot="${slot}"] .HyperMD-codeblock`).filter({ hasText: 'iiii WWWW 中文' });
      await expect(code).toHaveCount(3);
      const geometry = await code.evaluateAll(nodes => nodes.map((node, i) => {
        node.setAttribute('data-code-font-probe', String(i));
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        let text: Node | null; while ((text = walker.nextNode()) && !text.textContent?.includes('iiii WWWW')) {}
        const width = (start: number) => {
          const range = document.createRange(); range.setStart(text!, start); range.setEnd(text!, start + 4);
          return range.getBoundingClientRect().width;
        };
        const at = text!.textContent!.indexOf('iiii');
        return { family: getComputedStyle(node).fontFamily, narrow: width(at), wide: width(at + 5) };
      }));
      const { root } = await cdp.send('DOM.getDocument');
      for (let i = 0; i < geometry.length; i++) {
        expect(geometry[i].narrow).toBeCloseTo(geometry[i].wide, 4);
        const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId,
          selector: `[data-slot="${slot}"] [data-code-font-probe="${i}"]` });
        const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
        samples.push({ slot, ...geometry[i], fonts });
        expect(fonts.some(font => /Cascadia Code/.test(font.familyName) && font.isCustomFont)).toBe(true);
        expect(fonts.some(font => /Noto Sans SC/.test(font.familyName) && font.isCustomFont)).toBe(true);
        expect(fonts.some(font => /Noto Serif SC/.test(font.familyName))).toBe(false);
      }
    }
  } finally { await cdp.detach(); }
  await info.attach('painted-code-fonts', { body: JSON.stringify(samples), contentType: 'application/json' });
  await page.screenshot({ path: info.outputPath('body-formula-code-fonts.png'), fullPage: true });
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
});
