import { expect, test } from './test';
import type { Page } from '@playwright/test';

async function reset(page: Page, source: string) {
  await page.goto('/__render-test');
  await page.waitForFunction(() => Boolean(window.renderHarness));
  await page.evaluate(source => window.renderHarness.reset(source), source);
  await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe(source);
  await page.evaluate(length => window.renderHarness.cursor(0, length), source.length);
}

const title = (page: Page, type: string) => page.locator(`[data-slot="0"] .md-callout[data-callout="${type}"] > .md-callout-title`);

test('built-in CSS-declared callouts resolve color and Lucide icon', async ({ page }) => {
  await reset(page, '> [!definition]\n> a\n\n> [!premise]\n> b\n\n> [!conclusion]\n> c\n\n> [!proof]\n> d\n\nend');
  for (const [type, icon, color] of [
    ['definition', 'book-open', 'rgb(99, 102, 241)'],
    ['premise', 'layers', 'rgb(202, 138, 4)'],
    ['conclusion', 'flag', 'rgb(219, 39, 119)'],
    ['proof', 'check-circle', 'rgb(34, 197, 94)'],
  ]) {
    await expect(title(page, type).locator(`svg[data-lucide="${icon}"]`)).toHaveCount(1);
    await expect(title(page, type)).toHaveCSS('color', color);
    await expect(title(page, type).locator('.cm-callout-title')).toHaveText(type.charAt(0).toUpperCase() + type.slice(1));
  }
});

test('a stylesheet added at runtime defines a new callout without rebuilding', async ({ page }) => {
  await reset(page, '> [!mine] 自定义\n> body\n\n> [!proof]\n> p\n\n> [!raw]\n> r\n\nend');
  // Unknown type: default pencil and default color until a rule exists.
  await expect(title(page, 'mine')).toHaveCSS('color', 'rgb(8, 109, 221)');
  await page.addStyleTag({ content: `
    .callout[data-callout="mine"] { --callout-color: rgb(1, 2, 3); --callout-icon: lucide-anchor; }
    .callout[data-callout="proof"] { --callout-color: #ff0000; --callout-icon: lucide-check-circle; }
    .callout[data-callout="raw"] { --callout-icon: '<svg viewBox="0 0 24 24" onload="alert(1)"><circle class="raw-dot" cx="12" cy="12" r="4"/></svg>'; }
  ` });
  await expect(title(page, 'mine').locator('svg[data-lucide="anchor"]')).toHaveCount(1);
  await expect(title(page, 'mine')).toHaveCSS('color', 'rgb(1, 2, 3)');
  // Overriding a built-in keeps its pinned Lucide asset for the same name.
  await expect(title(page, 'proof')).toHaveCSS('color', 'rgb(255, 0, 0)');
  await expect(title(page, 'proof').locator('svg[data-lucide="check-circle"]')).toHaveCount(1);
  await expect(title(page, 'raw').locator('svg .raw-dot')).toHaveCount(1);
  expect(await title(page, 'raw').locator('.cm-callout-icon svg').getAttribute('onload')).toBeNull();
  // Removing the rule restores the defaults.
  await page.evaluate(() => document.querySelectorAll('style').forEach(style => {
    if (style.textContent?.includes('data-callout="mine"')) style.remove();
  }));
  await expect(title(page, 'mine')).toHaveCSS('color', 'rgb(8, 109, 221)');
  await expect(title(page, 'mine').locator('svg[data-lucide="anchor"]')).toHaveCount(0);
});
