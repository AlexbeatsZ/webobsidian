import { expect, test } from './test';
import { readFileSync } from 'node:fs';

const image = readFileSync('tests/fixtures/presentation-image.svg', 'utf8');
test.beforeEach(async ({ page }) => {
  await page.route('**/theme-media/**', route => route.fulfill({ contentType: 'image/svg+xml', body: image }));
  await page.goto('/__render-test');
  await page.waitForFunction(() => Boolean(window.renderHarness));
});

async function reset(page: import('@playwright/test').Page, source: string) {
  await page.evaluate(source => window.renderHarness.reset(source), source);
  await expect(page.locator('[data-slot="1"] .cm-content').first()).toContainText('end');
  await page.evaluate(() => window.renderHarness.cursor(0, window.renderHarness.source(0).length));
  await expect(page.locator('[data-render-pending]')).toHaveCount(0);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map(img => img.decode().catch(() => {})));
  });
}

test('Markdown and HTML image rows preserve captions, aliases, sizing and source', async ({ page }) => {
  const source = '![[/theme-media/one.png|图一|140]] ![图二|100](/theme-media/two.png)\n\n![plain.png|80](/theme-media/plain.png)\n\n<div><img src="/theme-media/html.png" alt="HTML 说明" width="120"><img src="/theme-media/html2.png" alt="second.png" width="80"></div>\n\nend';
  await reset(page, source);
  for (const slot of [0, 1]) {
    const host = page.locator(`[data-slot="${slot}"]`);
    const row = host.locator('.cm-image-row').first();
    const first = row.locator('.cm-image-wrap').nth(0), second = row.locator('.cm-image-wrap').nth(1);
    await expect(first).toHaveAttribute('data-image-caption', '图一');
    await expect(second).toHaveAttribute('data-image-caption', '图二');
    const a = await first.locator('img').boundingBox(), b = await second.locator('img').boundingBox();
    expect(Math.abs(a!.y + a!.height - b!.y - b!.height)).toBeLessThan(1);
    expect(b!.x).toBeGreaterThanOrEqual(a!.x + a!.width);
    expect(a!.width).toBe(140); expect(b!.width).toBe(100);
    const hidden = host.locator('[data-image-source="/theme-media/plain.png"]');
    expect(await hidden.evaluate(el => getComputedStyle(el, '::after').display)).toBe('none');
    const html = host.locator('.cm-html-block');
    await expect(html.locator('.cm-image-wrap').first()).toHaveAttribute('data-image-caption', 'HTML 说明');
    await expect(html.locator('.cm-image-row')).toHaveCount(1);
  }
  // Changing only alt text must replace a widget with the same image URL and width.
  const at = source.indexOf('图一');
  await page.evaluate(at => window.renderHarness.edit(0, [{ from: at, to: at + 2, insert: '新图' }]), at);
  await expect(page.locator('[data-slot="1"] .cm-image-wrap').first()).toHaveAttribute('data-image-caption', '新图');
  await page.evaluate(() => window.renderHarness.undo(0));
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
  await page.screenshot({ path: test.info().outputPath('image-rows.png') });
});

test('image presentation fragments survive resolution and theme changes', async ({ page }) => {
  const source = '![[/theme-media/center.png#center|居中|120]]\n\n![[/theme-media/scale.png#x1.5|缩放|100]]\n\n![[/theme-media/full.svg#full|原始矢量图]]\n\n> [!note] 图片\n> ![[/theme-media/inside.png|亮度|80]] ![[/theme-media/inside-dark.png#dark|反色|80]]\n\nend';
  await reset(page, source);
  const host = page.locator('[data-slot="1"]');
  const center = host.locator('[data-image-center]');
  const rect = await center.boundingBox(), content = await host.locator('.cm-content').first().boundingBox();
  expect(Math.abs(rect!.x + rect!.width / 2 - content!.x - content!.width / 2)).toBeLessThan(1);
  await expect(host.locator('[data-image-source*="#x1.5"] img')).toHaveCSS('zoom', '1.5');
  await expect(host.locator('[data-image-svg] img')).toHaveCSS('max-width', 'none');
  await page.evaluate(() => { document.querySelector('.theme-light')!.className = 'theme-dark'; });
  await expect(host.locator('[data-image-source="/theme-media/inside.png"] img')).toHaveCSS('filter', 'brightness(1.233) contrast(1)');
  await expect(host.locator('[data-image-dark] img')).toHaveCSS('filter', 'invert(0.88235) hue-rotate(180deg) brightness(1.233) contrast(1)');
  await page.emulateMedia({ media: 'print' });
  await expect(host.locator('[data-image-dark] img')).toHaveCSS('filter', 'none');
  await page.emulateMedia({ media: 'screen' });
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
});

test('embedded notes omit duplicate headings and expand without nested scroll caps', async ({ page }) => {
  const note = '# 嵌入标题\n\n' + Array.from({ length: 24 }, (_, i) => '段落 ' + i).join('\n\n') + '\n\n## 后续标题\n\n尾部';
  await page.evaluate(note => window.renderHarness.notes({ 'b.md': note }), note);
  await reset(page, '![[b]]\n\nend');
  const embed = page.locator('[data-slot="1"] .cm-note-embed');
  await expect(embed.locator('.markdown-embed-title')).toHaveCount(0);
  await expect(embed.locator('.cm-leading-heading')).toBeHidden();
  await page.evaluate(() => window.renderHarness.scroll(1, 2000));
  await expect(embed).toContainText('尾部');
  await expect(embed.locator('.markdown-embed-content')).toHaveCSS('max-height', 'none');
  await expect(embed.locator('.markdown-embed-content')).toHaveCSS('overflow-y', 'visible');
  await expect(embed.locator('.HyperMD-header-2')).toBeVisible();
  expect((await embed.boundingBox())!.height).toBeGreaterThan(400);
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe('![[b]]\n\nend');
});

test('Mermaid uses document typography and native surface colors inside callouts', async ({ page }) => {
  const source = '```mermaid\nflowchart LR\nA[正文节点] -->|连线| B[目标]\n```\n\n> [!note] 图表\n> ```mermaid\n> flowchart LR\n> A[内部节点] -->|连线| B[目标]\n> ```\n\nend';
  await reset(page, source);
  const host = page.locator('[data-slot="1"]');
  for (const [theme, outer, inner, text] of [['light', 'rgb(250, 250, 250)', 'rgb(245, 245, 245)', 'rgb(0, 0, 0)'], ['dark', 'rgb(37, 37, 37)', 'rgb(44, 44, 44)', 'rgb(255, 255, 255)']]) {
    await page.evaluate(theme => { document.querySelector('.theme-light,.theme-dark')!.className = 'theme-' + theme; }, theme);
    const diagrams = host.locator('.cm-mermaid');
    await expect(diagrams.nth(0).locator('.node .label-container').first()).toHaveCSS('fill', outer);
    await expect(diagrams.nth(1).locator('.node .label-container').first()).toHaveCSS('fill', inner);
    await expect(diagrams.nth(0).locator('.nodeLabel').first()).toHaveCSS('color', text);
    await expect(diagrams.nth(1).locator('foreignObject div').first()).toHaveCSS('font-size', '16px');
  }
  await page.screenshot({ path: test.info().outputPath('mermaid-surfaces.png') });
});

test('wide blocks keep intrinsic width and print retains image presentation', async ({ page }) => {
  const row = (values: string[]) => '| ' + values.join(' | ') + ' |';
  const table = [row(Array.from({ length: 24 }, (_, i) => '列' + i)), row(Array(24).fill('---')), row(Array(24).fill('WW'))].join('\n');
  const source = table + '\n\n> [!note] 宽内容\n>\n' + table.split('\n').map(line => '> ' + line).join('\n') + '\n\n==公式 $x^2$==\n\n![[/theme-media/print.png#dark|打印说明|100]]\n\nend';
  await reset(page, source);
  const host = page.locator('[data-slot="1"]');
  const content = await host.locator('.cm-content').first().boundingBox();
  expect((await host.locator('.cm-table-wrap').first().boundingBox())!.width).toBeGreaterThan(content!.width);
  expect((await host.locator('.md-callout').boundingBox())!.width).toBeGreaterThan(content!.width);
  const highlighted = host.locator('.math-inline');
  await expect(highlighted).toHaveCSS('background-color', 'rgb(224, 224, 224)');
  await page.evaluate(() => window.renderHarness.preparePrint());
  const printed = page.frameLocator('.note-print-frame');
  await expect(printed.locator('[data-image-caption="打印说明"]')).toHaveCount(1);
  await expect(printed.locator('.cm-image-resize')).toHaveCount(0);
  await expect(printed.locator('.cm-content').first()).toContainText('end');
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
});


test('resizing a magnified image patches only its source width', async ({ page }) => {
  const source = '![[/theme-media/resize.png#x2|图示|100]]\n\nend';
  await reset(page, source);
  const host = page.locator('[data-slot="0"]');
  const handle = host.locator('.cm-image-resize-right');
  await host.locator('.cm-image-wrap').hover();
  const box = await handle.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down(); await page.mouse.move(box!.x + box!.width / 2 + 60, box!.y + box!.height / 2); await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe(source.replace('|100', '|130'));
  await page.evaluate(() => window.renderHarness.undo(0));
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
});
