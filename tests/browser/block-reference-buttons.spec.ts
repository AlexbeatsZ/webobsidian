import { test, expect } from './test';

const source = [
  '$$', 'x=1', '$$', '',
  '| a |', '|---|', '| 1 |', '',
  '```js', 'x()', '```', '',
  '> [!note] Title', '> body', '',
  '<div>', 'html', '</div>', '',
  'end',
].join('\n');

test.beforeEach(async ({ page }) => {
  await page.goto('/__render-test');
  await page.waitForFunction(() => !!window.renderHarness);
  await page.evaluate(() => {
    (window as unknown as { copied: string[] }).copied = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (value: string) => { (window as unknown as { copied: string[] }).copied.push(value); } } });
  });
  await page.evaluate(source => window.renderHarness.reset(source), source);
  await expect(page.locator('[data-slot="0"] .cm-content').first()).toContainText('end');
  await page.evaluate(length => window.renderHarness.cursor(0, length), source.length);
  await expect(page.locator('[data-slot="0"] .cm-table-frame')).toBeVisible();
});

for (const [kind, host] of [
  ['eq', '.cm-math-rendered.math-block'],
  ['table', '.cm-table-frame'],
  ['code', '.md-code'],
  ['callout', '.md-callout'],
  ['html', '.cm-html-block'],
] as const) test(`${kind} corner buttons appear on hover and copy implicit then explicit references`, async ({ page }) => {
  const block = page.locator(`[data-slot="0"] ${host}`).first();
  const link = block.locator('.cm-reference-button[aria-label="复制隐式引用"]');
  const embed = block.locator('.cm-reference-button[aria-label="复制显式引用"]');
  // Effective opacity: the group or the button itself fades, like `</>`.
  const shown = (button: typeof link) => button.evaluate(element => {
    let opacity = 1;
    for (let node: Element | null = element; node && !node.classList.contains('cm-content'); node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
    return opacity;
  });
  await page.mouse.move(0, 0);
  await expect.poll(() => shown(link)).toBe(0);
  await block.hover();
  await expect.poll(() => shown(link)).toBe(1);
  await expect.poll(() => shown(embed)).toBe(1);
  await link.click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { copied: string[] }).copied.length)).toBe(1);
  const [first] = await page.evaluate(() => (window as unknown as { copied: string[] }).copied);
  expect(first).toMatch(new RegExp(`^\\[\\[\\^${kind}-[a-f\\d]+\\]\\]$`));
  const id = first.slice(3, -2);
  const raw = await page.evaluate(() => window.renderHarness.source(0));
  expect(raw.split(id)).toHaveLength(2);
  // The second copy reuses the identity instead of adding another.
  const again = page.locator(`[data-slot="0"] ${host}`).first();
  await again.hover();
  await again.locator('.cm-reference-button[aria-label="复制显式引用"]').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { copied: string[] }).copied[1])).toBe(`!${first}`);
  expect((await page.evaluate(() => window.renderHarness.source(0))).split(id)).toHaveLength(2);
  await page.evaluate(() => window.renderHarness.undo(0));
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
});
