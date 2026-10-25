import { test, expect } from './test';
import type { Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const longFormula = String.raw`\frac{\mathrm d}{\mathrm da}\langle f\rangle_a=\int f(x)\,\partial_a\rho(x-a)\,\mathrm dx=-\int f\,\rho'\,\mathrm dx=\int f'\,\rho\,\mathrm dx=\langle f'\rangle_a`;
const overflowingFormula = `${longFormula}=${longFormula}`;

function fixture(context: string) {
  const formulas = `$$x^2+y^2=z^2$$\n\n$$${overflowingFormula}$$\n\n$$${overflowingFormula}\\tag{2-3}$$\n\n$$x\\tag{A long explicit tag}$$`;
  const lines = context === 'list' ? ['- Item', ...formulas.split('\n').map(line => '  ' + line)]
    : context === 'callout' ? ['> [!info]+ Equations', ...formulas.split('\n').map(line => '> ' + line)]
    : formulas.split('\n').map(line => (context === 'quote' ? '> ' : context === 'nested quote' ? '> > ' : '') + line);
  return '# Chapter\n\n' + lines.join('\n') + '\n\nTail';
}

async function mount(page: Page, source: string, width = 720) {
  await page.goto('/__render-test');
  await page.waitForFunction(() => Boolean(window.renderHarness));
  await page.addStyleTag({ content: `[data-slot]{flex-shrink:0;width:${width}px!important}` });
  await page.evaluate(source => window.renderHarness.reset(source), source);
  await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe(source);
  await page.evaluate(() => window.renderHarness.cursor(0, window.renderHarness.source(0).replace(/\r\n/g, '\n').replace(/^\uFEFF/, '').length));
  await expect(page.locator('[data-slot="1"] .math-block svg')).not.toHaveCount(0);
  await expect(page.locator('[data-render-pending]')).toHaveCount(0);
  await expect(page.locator('[data-mml-node="merror"]')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
}

async function geometry(page: Page, selector = '[data-slot="1"]') {
  return page.locator(`${selector} .math-block`).evaluateAll(hosts => hosts.map(host => {
    const rect = (element: Element) => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
    };
    const body = host.querySelector<HTMLElement>('.cm-math-body')!;
    const output = body.querySelector<HTMLElement>('mjx-container')!;
    const svg = output.querySelector('svg')!;
    const label = host.querySelector('.cm-equation-number');
    const explicitLabel = svg.querySelector('g[data-mml-node="mtd"][id]');
    const explicitBody = svg.querySelector('g[data-mml-node="mlabeledtr"] > g[data-mml-node="mtd"]:not([id])');
    return { host: rect(host), body: rect(body), output: rect(output), svg: rect(svg), label: label && rect(label),
      explicitLabel: explicitLabel && rect(explicitLabel), explicitBody: explicitBody && rect(explicitBody),
      number: label?.textContent, content: rect(host.closest('.cm-content')!),
      parent: rect(host.parentElement!),
      overflow: getComputedStyle(body).overflowX, scrollWidth: body.scrollWidth, clientWidth: body.clientWidth,
      svgMarkup: svg.outerHTML, tex: output.getAttribute('aria-label'),
      scroll: (() => { const scroll = host.closest('.cm-scroller')!; return { width: scroll.clientWidth, full: scroll.scrollWidth, left: scroll.scrollLeft }; })() };
  }));
}

function clearNumbers(rows: Awaited<ReturnType<typeof geometry>>) {
  for (const row of rows) {
    expect(row.overflow).toBe('visible');
    expect(row.scrollWidth - row.clientWidth).toBeLessThanOrEqual(1);
    if (row.label) {
      expect(row.label.left - row.svg.right).toBeGreaterThanOrEqual(8);
      expect(Math.abs((row.label.top + row.label.bottom) / 2 - (row.body.top + row.body.bottom) / 2)).toBeLessThan(1);
    }
    if (row.explicitLabel) {
      expect(row.explicitBody).not.toBeNull();
      expect(row.explicitLabel.left - row.explicitBody!.right).toBeGreaterThanOrEqual(8);
      expect(row.label).toBeNull();
    }
  }
}

test('F02 automatic number stays clear of the screenshot formula', async ({ page }, info) => {
  const source = `# Chapter\n\n$$${overflowingFormula}$$ ^eq-feedback\n\n$$${overflowingFormula}\\tag{2-3}$$\n\nTail`;
  await mount(page, source, 720);
  const rows = await geometry(page);
  await info.attach('collision-geometry', { body: JSON.stringify(rows, null, 2), contentType: 'application/json' });
  await writeFile(info.outputPath('geometry.json'), JSON.stringify(rows, null, 2));
  await page.screenshot({ path: info.outputPath('equation-number.png'), fullPage: true });
  expect(rows[0].label!.left - rows[0].svg.right, 'native number must follow the complete SVG with a visible gap').toBeGreaterThanOrEqual(8);
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
});

for (const width of [420, 1040]) {
  for (const context of ['body', 'quote', 'nested quote', 'list', 'callout']) {
    test(`native and explicit tags retain intrinsic geometry: ${context}, ${width}px`, async ({ page }, info) => {
      const source = fixture(context);
      await page.setViewportSize({ width: width * 2 + 60, height: 1000 });
      await mount(page, source, width);
      const modes = [];
      for (const slot of [0, 1]) {
        await expect(page.locator(`[data-slot="${slot}"] .math-block`)).toHaveCount(4);
        const rows = await geometry(page, `[data-slot="${slot}"]`);
        await writeFile(info.outputPath(`geometry-slot-${slot}.json`), JSON.stringify(rows, null, 2));
        clearNumbers(rows);
        expect(rows.map(row => row.number)).toEqual(['(1-1)', '(1-2)', undefined, undefined]);
        expect(rows[1].host.right).toBeGreaterThan(rows[1].content.right);
        expect(rows[1].scroll.full).toBeGreaterThan(rows[1].scroll.width);
        expect(rows[1].svg.width).toBeGreaterThan(1000);
        expect(rows[1].svg.height).toBeLessThan(45);
        expect(rows[2].explicitLabel).not.toBeNull();
        expect(rows[3].explicitLabel).not.toBeNull();
        expect(Math.abs((rows[0].svg.left + rows[0].svg.right) / 2 - (rows[0].host.left + rows[0].host.right) / 2)).toBeLessThan(1);
        modes.push(rows);
      }
      expect(modes[0].map(row => row.svg.width)).toEqual(modes[1].map(row => row.svg.width));
      await writeFile(info.outputPath('geometry.json'), JSON.stringify(modes, null, 2));
      await info.attach('two-mode-geometry', { body: JSON.stringify(modes), contentType: 'application/json' });
      await page.screenshot({ path: info.outputPath('before-horizontal-scroll.png'), fullPage: true });
      await page.locator('.cm-scroller').evaluateAll(scrolls => scrolls.forEach(scroll => { scroll.scrollLeft = scroll.scrollWidth; }));
      await expect.poll(async () => (await geometry(page))[1].scroll.left).toBeGreaterThan(0);
      clearNumbers(await geometry(page));
      await page.screenshot({ path: info.outputPath('after-horizontal-scroll.png'), fullPage: true });
      expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
    });
  }
}

test('print freezes native and explicit tag geometry without clipping or source writes', async ({ page }, info) => {
  const source = fixture('callout');
  await mount(page, source);
  await page.evaluate(() => window.renderHarness.preparePrint());
  const frame = page.frameLocator('iframe.note-print-frame');
  await expect(frame.locator('.math-block')).toHaveCount(4);
  const rows = await frame.locator('.math-block').evaluateAll(hosts => hosts.map(host => {
    const right = (element: Element) => element.getBoundingClientRect().right;
    const body = host.querySelector('.cm-math-body')!;
    const svg = body.querySelector('svg')!;
    const label = host.querySelector('.cm-equation-number');
    const explicitLabel = svg.querySelector('g[data-mml-node="mtd"][id]');
    const explicitBody = svg.querySelector('g[data-mml-node="mlabeledtr"] > g[data-mml-node="mtd"]:not([id])');
    return { number: label?.textContent, width: svg.getBoundingClientRect().width, overflow: getComputedStyle(body).overflowX,
      gap: label ? label.getBoundingClientRect().left - right(svg) : explicitLabel!.getBoundingClientRect().left - right(explicitBody!),
      hostRight: right(host), columnRight: right(host.closest('.cm-content')!), editable: host.closest('[contenteditable]')?.getAttribute('contenteditable') };
  }));
  expect(rows.map(row => row.number)).toEqual(['(1-1)', '(1-2)', undefined, undefined]);
  for (const row of rows) { expect(row.gap).toBeGreaterThanOrEqual(8); expect(row.overflow).toBe('visible'); }
  expect(rows[1].width).toBeGreaterThan(1000);
  expect(rows[1].hostRight).toBeGreaterThan(rows[1].columnRight);
  await writeFile(info.outputPath('print-geometry.json'), JSON.stringify(rows, null, 2));
  await info.attach('print-geometry', { body: JSON.stringify(rows), contentType: 'application/json' });
  await page.locator('iframe.note-print-frame').evaluate(frame => {
    Object.assign((frame as HTMLElement).style, { opacity: '1', zIndex: '100', height: '900px', width: '1400px' });
  });
  await page.screenshot({ path: info.outputPath('print-prepared.png'), fullPage: true });
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
  expect(await page.evaluate(() => window.renderHarness.writes)).toEqual([]);
});

test('intrinsic overflow stays stable across resize, selection, renumbering and source reveal', async ({ page }, info) => {
  const source = `\uFEFF# Chapter\r\n\r\n$$${overflowingFormula}$$ ^eq-stable\r\n\r\n$$x+1$$\r\n\r\nTail`;
  await mount(page, source, 720);
  const nodes = await page.locator('[data-slot="1"] .cm-math-body > mjx-container').elementHandles();
  const originalWidths = (await geometry(page)).map(row => row.svg.width);
  const initial = await geometry(page);
  await page.evaluate(() => {
    const probe = window as typeof window & { f02Adoptions?: number; f02Observer?: MutationObserver };
    probe.f02Adoptions = 0;
    probe.f02Observer = new MutationObserver(records => {
      probe.f02Adoptions! += records.flatMap(record => [...record.addedNodes]).filter(node => node instanceof Element && node.matches('mjx-container')).length;
    });
    probe.f02Observer.observe(document.body, { childList: true, subtree: true });
  });
  for (let cycle = 0; cycle < 8; cycle++) {
    await page.evaluate(() => {
      window.renderHarness.cursor(0, window.renderHarness.source(0).replace(/\r\n/g, '\n').length - 2);
      window.dispatchEvent(new Event('resize'));
    });
  }
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  for (let index = 0; index < nodes.length; index++) {
    expect(await nodes[index].evaluate((node, index) => node === document.querySelectorAll('[data-slot="1"] .cm-math-body > mjx-container')[index], index)).toBe(true);
  }
  const stable = await geometry(page);
  expect(stable.map(row => row.svg)).toEqual(initial.map(row => row.svg));
  expect(await page.evaluate(() => (window as any).f02Adoptions)).toBe(0);
  const resized = [];
  for (const width of [420, 1040, 720]) {
    const before = await page.evaluate(() => (window as any).f02Adoptions as number);
    await page.locator('[data-slot]').evaluateAll((hosts, width) => hosts.forEach(host => (host as HTMLElement).style.setProperty('width', `${width}px`, 'important')), width);
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await page.evaluate(async () => { for (let frame = 0; frame < 8; frame++) await new Promise(requestAnimationFrame); });
    await expect(page.locator('[data-render-pending]')).toHaveCount(0);
    await expect.poll(async () => (await geometry(page))[0].scroll.width).toBeLessThanOrEqual(width);
    clearNumbers(await geometry(page));
    expect((await geometry(page)).map(row => row.svg.width)).toEqual(originalWidths);
    const adoptions = await page.evaluate(() => (window as any).f02Adoptions as number) - before;
    await writeFile(info.outputPath(`resize-${width}.json`), JSON.stringify({ adoptions, rows: await geometry(page) }, null, 2));
    expect(adoptions).toBeLessThanOrEqual(4);
    const settled = await page.evaluate(() => (window as any).f02Adoptions as number);
    await page.evaluate(async () => { for (let frame = 0; frame < 8; frame++) await new Promise(requestAnimationFrame); });
    expect(await page.evaluate(() => (window as any).f02Adoptions as number)).toBe(settled);
    resized.push({ width, adoptions, rows: await geometry(page) });
  }
  const originalIds = await page.locator('[data-slot="1"] svg').evaluateAll(svgs => svgs.map(svg => [...svg.querySelectorAll('[id]')].map(node => node.id)));
  await page.evaluate(() => window.renderHarness.edit(0, [{ from: 0, to: 0, insert: '# Another\n\n$$q=1$$\n\n' }]));
  await expect(page.locator('[data-slot="1"] .cm-equation-number').nth(1)).toHaveText('(2-1)');
  await expect(page.locator('[data-render-pending]')).toHaveCount(0);
  await page.evaluate(() => window.renderHarness.undo(0));
  await expect(page.locator('[data-slot="1"] .cm-equation-number').first()).toHaveText('(1-1)');
  await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe(source);
  await page.evaluate(pos => window.renderHarness.cursor(0, pos), source.replace(/\r\n/g, '\n').indexOf('\\frac') + 5);
  await expect(page.locator('[data-slot="0"] .cm-math-edit-preview')).toHaveCount(1);
  await expect(page.locator('[data-render-pending]')).toHaveCount(0);
  clearNumbers(await geometry(page, '[data-slot="0"]'));
  await page.screenshot({ path: info.outputPath('source-edit-preview.png'), fullPage: true });
  await page.evaluate(() => window.renderHarness.mode(0, 'source'));
  await expect(page.locator('[data-slot="0"] .math-block:not(.cm-math-edit-preview)')).toHaveCount(0);
  await page.evaluate(() => window.renderHarness.mode(0, 'reading'));
  await expect(page.locator('[data-slot="0"] .math-block')).toHaveCount(2);
  await expect(page.locator('[data-render-pending]')).toHaveCount(0);
  clearNumbers(await geometry(page, '[data-slot="0"]'));
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
  await page.evaluate(() => (window as any).f02Observer.disconnect());
  await writeFile(info.outputPath('lifecycle.json'), JSON.stringify({ initial, stable, resized, originalIds }, null, 2));
  await info.attach('resize-and-lifecycle', { body: JSON.stringify({ initial, stable, resized, originalIds }), contentType: 'application/json' });
});

test('shared queue deduplicates, caches and cancels without late writes or intrinsic-width feedback', async ({ page }, info) => {
  await page.goto('/__render-test');
  await page.waitForFunction(() => Boolean(window.renderHarness));
  const result = await page.evaluate(async tex => {
    const { loadMathJax, renderMath, readMathMetrics } = await import('/src/lib/mathjax.ts');
    const runtime = await loadMathJax();
    const factory = runtime.startup.mathjax.document;
    const conversions: string[] = [];
    let release: (() => void) | undefined;
    let started: (() => void) | undefined;
    const blocked = new Promise<void>(resolve => { started = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    runtime.startup.mathjax.document = function (...args: Parameters<typeof factory>) {
      const document = factory.apply(this, args);
      const convert = document.convertPromise;
      document.convertPromise = async function (source, options) {
        if (source !== '\\begingroupSandbox') conversions.push(source);
        if (source.includes('f02cancel')) { started?.(); await gate; }
        return convert.call(this, source, options);
      };
      return document;
    };
    const parent = document.createElement('div'); parent.style.width = '480px'; document.body.appendChild(parent);
    const bodies = Array.from({ length: 4 }, () => { const body = document.createElement('span'); parent.appendChild(body); return body; });
    const metrics = readMathMetrics(bodies[0], parent);
    try {
      await Promise.all(bodies.slice(0, 2).map(body => renderMath(body, tex, true, new AbortController().signal, { metrics })));
      const afterPair = conversions.length;
      await renderMath(bodies[2], tex, true, new AbortController().signal, { metrics });
      const afterCache = conversions.length;
      const ids = bodies.slice(0, 3).flatMap(body => [...body.querySelectorAll('[id]')].map(node => node.id));
      const cancelled = new AbortController();
      const pending = renderMath(bodies[3], tex + '+\\mathrm{f02cancel}', true, cancelled.signal, { metrics });
      await blocked; cancelled.abort(); bodies[3].remove(); release?.(); await pending;
      return { afterPair, afterCache, uniqueIds: new Set(ids).size === ids.length, ids: ids.length,
        cancelledChildren: bodies[3].childElementCount, conversions: conversions.length };
    } finally { runtime.startup.mathjax.document = factory; parent.remove(); }
  }, overflowingFormula + '+\\mathrm{f02cache}');
  expect(result).toEqual({ afterPair: 1, afterCache: 1, uniqueIds: true, ids: expect.any(Number), cancelledChildren: 0, conversions: 2 });
  expect(result.ids).toBeGreaterThan(10);
  await info.attach('queue-cache-cancel', { body: JSON.stringify(result), contentType: 'application/json' });
  await writeFile(info.outputPath('queue-cache-cancel.json'), JSON.stringify(result, null, 2));
});

test('inline cursor and equation-reference previews keep the existing renderer and explicit tag', async ({ page }, info) => {
  const source = `Inline $x+1$\n\n$$${overflowingFormula}\\tag{2-3}$$ ^eq-hover\n\nReference [[#^eq-hover]]\n\nTail`;
  await mount(page, source);
  await page.evaluate(pos => window.renderHarness.cursor(0, pos), source.indexOf('$x+1$') + 2);
  await expect(page.locator('.cm-tooltip-cursor [data-mathjax-version]')).toHaveCount(1);
  await page.evaluate(() => window.renderHarness.cursor(0, window.renderHarness.source(0).length));
  await expect(page.locator('.cm-tooltip-cursor')).toHaveCount(0);
  await page.locator('[data-slot="1"] .cm-wikilink').hover();
  await expect(page.locator('.cm-link-preview [data-mathjax-version]')).toHaveCount(1);
  const result = await page.locator('.cm-link-preview').evaluate(tooltip => {
    const label = tooltip.querySelector('g[data-mml-node="mtd"][id]')!;
    const body = tooltip.querySelector('g[data-mml-node="mlabeledtr"] > g[data-mml-node="mtd"]:not([id])')!;
    return { gap: label.getBoundingClientRect().left - body.getBoundingClientRect().right,
      automatic: tooltip.querySelectorAll('.cm-equation-number').length, version: tooltip.querySelector('[data-mathjax-version]')!.getAttribute('data-mathjax-version') };
  });
  expect(result.gap).toBeGreaterThanOrEqual(8);
  expect(result.automatic).toBe(0);
  expect(result.version).toBe('4.1.3');
  await page.locator('.cm-link-preview').hover();
  const visibleTag = await page.locator('.cm-link-preview').evaluate(popup => {
    const label = popup.querySelector('g[data-mml-node="mtd"][id]')!;
    let parent = label.parentElement;
    const scrolled = [];
    while (parent) {
      if (parent.scrollWidth > parent.clientWidth && ['auto', 'scroll'].includes(getComputedStyle(parent).overflowX)) {
        parent.scrollLeft = parent.scrollWidth;
        scrolled.push({ className: parent.getAttribute('class'), left: parent.scrollLeft });
      }
      if (parent === popup) break;
      parent = parent.parentElement;
    }
    const tag = label.getBoundingClientRect(), box = popup.getBoundingClientRect();
    return { scrolled, labelLeft: tag.left, labelRight: tag.right, popupLeft: box.left, popupRight: box.right };
  });
  expect(visibleTag.scrolled.some(scroll => scroll.left > 0)).toBe(true);
  expect(visibleTag.labelLeft).toBeGreaterThanOrEqual(visibleTag.popupLeft);
  expect(visibleTag.labelRight).toBeLessThanOrEqual(visibleTag.popupRight);
  await page.screenshot({ path: info.outputPath('equation-reference-preview.png'), fullPage: true });
  await info.attach('reference-preview-geometry', { body: JSON.stringify({ ...result, visibleTag }), contentType: 'application/json' });
  await writeFile(info.outputPath('reference-preview.json'), JSON.stringify({ ...result, visibleTag }, null, 2));
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
});

test('dark screenshot-sized formula overflows without a native-number collision', async ({ page }, info) => {
  const source = `# First\n\n$$a$$\n\n# Second\n\n$$b$$\n\n$$c$$\n\n$$${longFormula}$$\n\nTail`;
  await mount(page, source, 600);
  await page.evaluate(() => { document.querySelector('.theme-light')!.className = 'theme-dark'; window.renderHarness.closeSecondary(); });
  await expect(page.locator('[data-slot="0"] .cm-equation-number').last()).toHaveText('(2-3)');
  const rows = await geometry(page, '[data-slot="0"]');
  clearNumbers(rows);
  expect(rows[3].host.right).toBeGreaterThan(rows[3].content.right);
  const scroller = page.locator('[data-slot="0"] .cm-scroller');
  await scroller.evaluate(element => { element.scrollLeft = element.scrollWidth; });
  await expect.poll(() => scroller.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  clearNumbers(await geometry(page, '[data-slot="0"]'));
  await page.screenshot({ path: info.outputPath('dark-screenshot-formula.png'), fullPage: true });
  await writeFile(info.outputPath('geometry.json'), JSON.stringify(rows, null, 2));
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
});
