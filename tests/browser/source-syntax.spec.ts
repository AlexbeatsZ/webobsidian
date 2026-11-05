import { expect, test } from './test';
import type { Page } from '@playwright/test';

// Renderable syntax revealed by the caret uses the faint ^id colour; content stays normal.
const cases: [string, string, number, string[], string[]][] = [
  ['bold', 'a **bold** z', 5, ['**'], ['bold']],
  ['code', 'a `code` z', 4, ['`'], ['code']],
  ['wikilink alias', 'a [[Note|别名]] z', 4, ['[[Note|', ']]'], ['别名']],
  ['markdown link', 'a [text](http://x.y) z', 4, ['[', '](http://x.y)'], ['text']],
  ['footnote', 'a[^1] z', 3, ['[^', ']'], []],
  ['html', 'a <u>u</u> z', 4, ['<', '>', '</'], []],
  ['task', '- [ ] task', 3, ['- '], ['task']],
  ['list', '- item', 0, ['-'], ['item']],
  ['escape', 'a \\* z', 3, ['\\'], []],
  ['callout', '> [!tip] 标题', 4, ['> ', '[!tip] '], ['标题']],
];

async function colours(page: Page, source: string, caret: number) {
  await page.evaluate(s => window.renderHarness.reset(s), source);
  await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe(source);
  await page.evaluate(p => window.renderHarness.cursor(0, p), caret);
  return page.evaluate(() => {
    const content = document.querySelector('[data-slot="0"] .cm-content')!;
    const line = [...content.querySelectorAll('.cm-line')].find(l => /\S/.test(l.textContent!) && !/^(intro|end|> ?body)$/.test(l.textContent!.trim()))!;
    const faint = getComputedStyle(content.querySelector('.cm-line')!).getPropertyValue('--text-faint').trim();
    const probe = document.createElement('span'); probe.style.color = faint; content.append(probe);
    const faintRgb = getComputedStyle(probe).color; probe.remove();
    const parts: [string, boolean][] = [];
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode())
      if (n.textContent!.trim()) parts.push([n.textContent!, getComputedStyle(n.parentElement!).color === faintRgb]);
    return parts;
  });
}

test('revealed renderable syntax uses the ^id colour', async ({ page }) => {
  await page.goto('/__render-test');
  await page.waitForFunction(() => Boolean(window.renderHarness));
  for (const [label, line, caret, faint, normal] of cases) {
    const source = 'intro\n\n' + line + (label === 'callout' ? '\n> body' : '') + '\n\nend';
    const parts = await colours(page, source, 7 + caret);
    for (const text of faint) expect(parts.some(([t, f]) => t === text && f), `${label}: ${text} faint in ${JSON.stringify(parts)}`).toBe(true);
    for (const text of normal) expect(parts.some(([t, f]) => t === text && !f), `${label}: ${text} normal in ${JSON.stringify(parts)}`).toBe(true);
  }
  // Rendered (caret away): the syntax is hidden again.
  const parts = await colours(page, 'intro\n\na **bold** z\n\nend', 0);
  expect(parts.map(([t]) => t).join('')).not.toContain('**');
});

test('AI-style \\( \\) and \\[ \\] render as math and reveal faint delimiters', async ({ page }) => {
  await page.goto('/__render-test');
  await page.waitForFunction(() => Boolean(window.renderHarness));
  const source = 'intro\n\n行内 \\(\\alpha^2\\) 公式\n\n\\[\nE = mc^2\n\\]\n\n引用 \\[吕九\\]\n\nend';
  await page.evaluate(s => window.renderHarness.reset(s), source);
  await page.evaluate(length => window.renderHarness.cursor(0, length), source.length);
  const live = page.locator('[data-slot="0"]');
  await expect(live.locator('mjx-container[jax="SVG"]:not([display="true"])')).toHaveCount(1);
  await expect(live.locator('mjx-container[jax="SVG"][display="true"]')).toHaveCount(1);
  // Escaped literal brackets stay text (the backslashes are concealed as escapes).
  await expect(live.locator('.cm-line', { hasText: '引用 [吕九]' })).toHaveCount(1);
  // Caret inside the inline formula: delimiters are source in the ^id colour.
  await page.evaluate(p => window.renderHarness.cursor(0, p), source.indexOf('alpha'));
  const delimiters = live.locator('.cm-tex-delimiter');
  await expect(delimiters).toHaveText(['\\(', '\\)']);
  const faint = await delimiters.first().evaluate(el => getComputedStyle(el).color);
  const blockId = await page.evaluate(() => {
    const probe = document.createElement('span'); probe.className = 'cm-blockid';
    document.querySelector('[data-slot="0"] .cm-line')!.append(probe);
    const colour = getComputedStyle(probe).color; probe.remove(); return colour;
  });
  expect(faint).toBe(blockId);
});
