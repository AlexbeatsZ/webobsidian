import { expect, test } from './test';
import type { Page } from '@playwright/test';

async function positions(page: Page, labels: string[], position?: number) {
  return page.evaluate(({ labels, position }) => {
    if (position !== undefined) window.renderHarness.cursor(0, position);
    const content = document.querySelector('[data-slot="0"] .cm-content')!;
    return labels.map(label => {
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const offset = node.textContent!.indexOf(label);
        if (offset < 0) continue;
        const range = document.createRange();
        range.setStart(node, offset); range.setEnd(node, offset + label.length);
        return range.getBoundingClientRect().left;
      }
      throw new Error('Missing body text: ' + label);
    });
  }, { labels, position });
}

async function reset(page: Page, source: string) {
  await page.evaluate(source => window.renderHarness.reset(source), source);
  await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe(source);
  await page.evaluate(length => window.renderHarness.cursor(0, length), source.length);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLElement>('[data-slot="0"] .cm-line[data-prefix-layout]')]
    .every(line => line.style.getPropertyValue('--cm-quote-prefix-width') !== '' && line.style.getPropertyValue('--cm-list-prefix-width') !== ''));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

test.beforeEach(async ({ page }) => {
  await page.goto('/__render-test');
  await page.waitForFunction(() => Boolean(window.renderHarness));
});

test('@prefix selection and pointer changes retain measured prefix geometry before paint', async ({ page }, testInfo) => {
  const source = '> QuoteAnchor **bold choice**\n> > NestedAnchor\n\n- ListAnchor **list choice**\n    - ChildAnchor\n\nTail';
  const labels = ['QuoteAnchor', 'NestedAnchor', 'ListAnchor', 'ChildAnchor'];
  await reset(page, source);
  const baseline = await positions(page, labels);
  const samples: number[][] = [];
  for (const position of [0, source.indexOf('bold choice') + 2, source.indexOf('ListAnchor'), source.length]) {
    // Read immediately after CM sync, before a measurement microtask could hide
    // a transient loss of the owned line styles. No CM coords call repairs it.
    samples.push(await positions(page, labels, position));
    for (let frame = 0; frame < 4; frame++) {
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
      samples.push(await positions(page, labels));
    }
  }
  await page.locator('[data-slot="0"] .cm-strong').first().click();
  for (let frame = 0; frame < 12; frame++) {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    samples.push(await positions(page, labels));
  }
  await testInfo.attach('prefix-position-samples', { body: JSON.stringify({ labels, baseline, samples }, null, 2), contentType: 'application/json' });
  for (const sample of samples) sample.forEach((left, index) => expect(Math.abs(left - baseline[index]), labels[index]).toBeLessThanOrEqual(0.1));
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
});

test('@prefix deleted and merged lines cannot donate geometry to their neighbor; undo restores source', async ({ page }, testInfo) => {
  const source = '> > WideAnchor\n\nPlainAnchor\n\nTail';
  await reset(page, source);
  const deleted = await page.evaluate(to => {
    window.renderHarness.edit(0, [{ from: 0, to, insert: '' }]);
    const line = [...document.querySelectorAll<HTMLElement>('[data-slot="0"] .cm-line')].find(line => line.textContent?.includes('PlainAnchor'))!;
    return { text: line.textContent, style: line.getAttribute('style'), source: window.renderHarness.source(0) };
  }, source.indexOf('PlainAnchor'));
  await testInfo.attach('immediate-delete', { body: JSON.stringify(deleted, null, 2), contentType: 'application/json' });
  expect(deleted.source).toBe('PlainAnchor\n\nTail');
  expect(deleted.style ?? '').not.toContain('--cm-quote-prefix-width');
  expect(deleted.style ?? '').not.toContain('--cm-list-prefix-width');
  await page.evaluate(() => window.renderHarness.undo(0));
  await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe(source);
  await expect(page.locator('[data-slot="0"] .cm-quote-prefix')).toHaveCount(1);

  const original = '> > WideAnchor\n> NarrowAnchor\n\nTail';
  await reset(page, original);
  const newline = original.indexOf('\n');
  await page.evaluate(newline => window.renderHarness.edit(0, [{ from: newline, to: newline + 1, insert: '' }]), newline);
  const merged = original.slice(0, newline) + original.slice(newline + 1);
  await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe(merged);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const afterMerge = await positions(page, ['WideAnchor', 'NarrowAnchor']);
  await page.evaluate(() => window.renderHarness.undo(0));
  await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe(original);
  await expect(page.locator('[data-slot="0"] .cm-quote-prefix')).toHaveCount(2);
  await reset(page, merged);
  const fresh = await positions(page, ['WideAnchor', 'NarrowAnchor']);
  await testInfo.attach('merge-versus-fresh', { body: JSON.stringify({ afterMerge, fresh }, null, 2), contentType: 'application/json' });
  fresh.forEach((left, index) => expect(Math.abs(left - afterMerge[index])).toBeLessThanOrEqual(0.1));
});

for (const [name, delimiter] of [['bold', '**'], ['italic', '*'], ['strike', '~~'], ['inline code', '`']]) {
  test(`@prefix multiline ${name} retains structural quote and list prefixes`, async ({ page }) => {
    const source = `> - ${delimiter}QuoteFirst\n>   QuoteSecond${delimiter}\n\nTail`;
    await reset(page, source);
    const live = page.locator('[data-slot="0"] .cm-content');
    await expect(live.locator('.cm-quote-prefix')).toHaveCount(2);
    expect(await live.locator('.cm-quote-prefix').allTextContents()).toEqual(['> ', '> ']);
    await expect(live.locator('.cm-list-prefix')).toHaveCount(2);
    expect(await live.innerText()).not.toContain(delimiter);
    expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
    // Reveal just the inline syntax, then leave it again. Structural ownership
    // must survive both CM synchronizations without an extra source edit.
    await page.evaluate(position => window.renderHarness.cursor(0, position), source.indexOf('QuoteFirst') + 2);
    await expect(live.locator('.cm-quote-prefix')).toHaveCount(2);
    await page.evaluate(length => window.renderHarness.cursor(0, length), source.length);
    await expect(live.locator('.cm-quote-prefix')).toHaveCount(2);
    expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
  });
}
