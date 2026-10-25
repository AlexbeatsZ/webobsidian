import { test, expect } from './test';

test.beforeEach(async ({ page }) => {
  await page.goto('/__render-test');
  await page.waitForFunction(() => !!window.renderHarness);
});

test('landing highlights the target in the requested view and preserves source', async ({ page }) => {
  const raw = '\ufeff# Start\r\n\r\n[[#Destination]]\r\n\r\n' + 'padding\r\n\r\n'.repeat(60) + '# Destination\r\n\r\nbody';
  await page.evaluate(raw => window.renderHarness.reset(raw), raw);
  const result = await page.evaluate(() => window.renderHarness.navigate(1, { fragment: 'Destination' }));
  expect(result.status).toBe('opened');
  await expect(page.locator('[data-slot="1"] .cm-navigation-target')).toContainText('Destination');
  await expect(page.locator('[data-slot="0"] .cm-navigation-target')).toHaveCount(0);
  expect(await page.evaluate(() => window.renderHarness.source(1))).toBe(raw);
});

test('navigation unfolds a default collapsed callout in reading mode', async ({ page }) => {
  const raw = '# Start\n\n> [!note]- Folded\n> hidden destination ^inside\n\nend';
  await page.evaluate(raw => window.renderHarness.reset(raw), raw);
  const result = await page.evaluate(() => window.renderHarness.navigate(1, { fragment: '^inside' }));
  expect(result.status).toBe('opened');
  await expect(page.locator('[data-slot="1"] .cm-navigation-target')).toContainText('hidden destination');
  await expect(page.locator('[data-slot="1"] .cm-navigation-target')).toBeVisible();
});

test('plugin line intent uses normalized editor coordinates without changing the source', async ({ page }) => {
  const raw = '\ufeff# Title\r\n\r\nthird line\r\nlast';
  await page.evaluate(raw => window.renderHarness.reset(raw), raw);
  const result = await page.evaluate(() => window.renderHarness.navigate(0, { line: 2, focus: false }));
  expect(result.status).toBe('opened');
  expect(await page.evaluate(() => window.renderHarness.location(0)?.anchor)).toBe('# Title\n\n'.length);
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(raw);
});

test('rich footnotes collect at the end and return to each occurrence', async ({ page }, info) => {
  const raw = '# Note\n\nfirst[^a] and second[^a]. Inline ^[**rich** $x^2$].\n\n[^a]: **bold body** and $E=mc^2$\n\n    - continued list\n\nend';
  await page.evaluate(raw => window.renderHarness.reset(raw), raw);
  const reading = page.locator('[data-slot="1"]');
  await expect(reading.locator('.cm-footnote-reference')).toHaveText(['1', '1', '2']);
  await expect(reading.locator('.cm-footnote-entry')).toHaveCount(2);
  await expect(reading.locator('.cm-footnote-body').first()).toContainText('bold body');
  await expect(reading.locator('.cm-footnote-body').first()).toContainText('continued list');
  await expect(reading.locator('.cm-footnote-body mjx-container')).toHaveCount(2);
  await reading.locator('.cm-footnote-reference').first().click();
  await expect(reading.locator('.cm-footnote-entry').first()).toHaveClass(/cm-navigation-target/);
  await reading.locator('.cm-footnote-returns').first().getByRole('link', { name: '返回第 2 处引用' }).click();
  expect(await page.evaluate(() => window.renderHarness.location(1)?.anchor)).toBe(raw.indexOf('[^a]', raw.indexOf('[^a]') + 1));
  expect(await page.evaluate(() => window.renderHarness.source(1))).toBe(raw);
  await page.screenshot({ path: info.outputPath('footnotes.png') });
});

for (const slot of [0, 1]) test(`footnote definition number returns to a highlighted reference in slot ${slot}`, async ({ page }, info) => {
  const raw = '# Note\n\n保持 $X_U$不变(外界持续维持一个固定的温度相关驱动力[^1]),允许 $X_n$自由调整.\n\n'
    + 'padding\n\n'.repeat(45) + '[^1]: 这和前面的假设等价,因为流必然会使得驱动力变小,如果驱动力可以保持不变必然表示有维持此流我外界驱动力\n\nend';
  await page.evaluate(raw => window.renderHarness.reset(raw), raw);
  const editor = page.locator(`[data-slot="${slot}"]`);
  await editor.locator('.cm-footnote-reference').click();
  await expect(editor.locator(slot ? '.cm-footnote-entry.cm-navigation-target' : '.cm-navigation-target')).toContainText('这和前面的假设等价');
  if (slot) await expect(editor.locator('.cm-footnote-body .cm-editor')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await editor.locator(slot ? '.cm-footnote-number' : '.cm-footnote-definition').click();
  expect(await page.evaluate(slot => window.renderHarness.location(slot)?.anchor, slot)).toBe(raw.indexOf('[^1]'));
  await expect(editor.locator('.cm-footnote-reference.cm-navigation-target')).toBeVisible();
  expect(await page.evaluate(slot => window.renderHarness.source(slot), slot)).toBe(raw);
  await page.screenshot({ path: info.outputPath(`footnote-number-${slot}.png`) });
});

test('footnote preview uses full-document numbering and rich body without a modifier', async ({ page }, info) => {
  await page.evaluate(() => window.renderHarness.reset('# Title\n\nword[^n]\n\n[^n]: **Preview body** $x$\n\nend'));
  await page.locator('[data-slot="0"] .cm-footnote-reference').hover();
  const preview = page.getByRole('dialog', { name: '链接预览' });
  await expect(preview).toBeVisible();
  await expect(preview).toContainText('Preview body');
  await expect(preview.locator('mjx-container')).toHaveCount(1);
  await preview.hover();
  await expect(preview).toBeVisible();
  await page.screenshot({ path: info.outputPath('footnote-preview.png') });
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
});

test('ordinary preview observes live versus reading policy and subscribes to note updates', async ({ page }) => {
  await page.evaluate(() => {
    window.renderHarness.notes({ 'Target.md': '# Part\n\n**Original**' });
    window.renderHarness.reset('# Source\n\n[[Target#Part]]\n\nend');
  });
  await page.locator('[data-slot="0"] [data-preview-link]').hover();
  await page.waitForTimeout(400);
  await expect(page.locator('.cm-link-preview')).toHaveCount(0);
  await page.keyboard.down('Control');
  await expect(page.locator('.cm-link-preview')).toContainText('Original');
  await page.evaluate(() => window.renderHarness.changeNote('Target.md', '# Part\n\n**Updated**'));
  await expect(page.locator('.cm-link-preview')).toContainText('Updated');
  await page.keyboard.up('Control');
  await expect(page.locator('.cm-link-preview')).toHaveCount(0);
  await page.locator('[data-slot="1"] [data-preview-link]').hover();
  await expect(page.locator('.cm-link-preview')).toContainText('Updated');
  await page.evaluate(() => window.renderHarness.closeSecondary());
  await expect(page.locator('.cm-link-preview')).toHaveCount(0);
});

test('footnote fragments refresh the full-note context when another definition changes', async ({ page }) => {
  const source = 'first[^a] and second[^b]\n\n[^a]: see [^b]\n\n[^b]: Original body\n\nend';
  await page.evaluate(source => window.renderHarness.reset(source), source);
  const reading = page.locator('[data-slot="1"]');
  const original = reading.locator('.cm-footnote-entry').first();
  await expect(original).toContainText('see');
  await page.evaluate(() => {
    const source = window.renderHarness.source(0), from = source.indexOf('Original body');
    window.renderHarness.edit(0, [{ from, to: from + 'Original body'.length, insert: 'Updated body' }]);
  });
  await original.locator('.cm-footnote-reference').hover();
  await expect(page.getByRole('dialog', { name: '链接预览' })).toContainText('Updated body');
});

test('missing and duplicate definitions are explicit; navigation does not pretend success', async ({ page }) => {
  await page.evaluate(() => window.renderHarness.reset('# Title\n\nmissing[^x] duplicate[^d]\n\n[^d]: one\n\n[^d]: two\n\nend'));
  await expect(page.locator('[data-slot="1"] .cm-footnote-reference.is-unresolved')).toHaveCount(2);
  const result = await page.evaluate(() => window.renderHarness.navigate(1, { fragment: '[^d]' }));
  expect(result.status).toBe('missing');
  await expect(page.locator('[data-slot="1"] .cm-footnote-entry')).toContainText(['未找到脚注定义', '脚注定义重复']);
});

test('location restores selection and scroll after a same-note jump and live edits', async ({ page }) => {
  const raw = '# Start\n\n' + 'line of content\n\n'.repeat(100) + '# End\n\nlast';
  await page.evaluate(raw => window.renderHarness.reset(raw), raw);
  await page.evaluate(() => { window.renderHarness.cursor(0, 35, 39); window.renderHarness.scroll(0, 300); });
  const location = await page.evaluate(() => window.renderHarness.location(0)!);
  await page.evaluate(() => window.renderHarness.navigate(0, { fragment: 'End' }));
  await page.evaluate(() => window.renderHarness.edit(0, [{ from: 0, to: 0, insert: 'prefix\n\n' }]));
  const result = await page.evaluate(location => window.renderHarness.navigate(0, { location }), location);
  expect(result.status).toBe('opened');
  const restored = await page.evaluate(() => window.renderHarness.location(0)!);
  expect(restored.anchor).toBe(location.anchor! + 8);
  expect(restored.head).toBe(location.head! + 8);
});

test('a newer request cancels a pending destination and range search verifies source text', async ({ page }) => {
  await page.evaluate(() => window.renderHarness.reset('# Start\n\nunique match\n\n# End\n\nbody'));
  const results = await page.evaluate(async () => {
    const module = (path: string) => import(path);
    const { navigateTo } = await module('/src/lib/fragmentNavigation.ts');
    const pending = navigateTo('not-loaded.md', { viewId: 'harness:1', fragment: 'old' });
    const current = window.renderHarness.navigate(1, { fragment: 'End' });
    return Promise.all([pending, current]);
  });
  expect(results.map(result => result.status)).toEqual(['cancelled', 'opened']);
  await page.evaluate(() => window.renderHarness.edit(0, [{ from: 0, to: 0, insert: 'prefix\n\n' }]));
  const moved = await page.evaluate(() => window.renderHarness.navigate(1, { range: { from: 9, to: 21 }, text: 'unique match' }));
  expect(moved.status).toBe('opened');
  expect(await page.evaluate(() => window.renderHarness.location(1)?.anchor)).toBe(17);
  const missing = await page.evaluate(() => window.renderHarness.navigate(1, { range: { from: 0, to: 5 }, text: 'disappeared' }));
  expect(missing.status).toBe('missing');
});

test('nested Markdown destinations and escaped wiki syntax use the shared metadata', async ({ page }) => {
  await page.evaluate(() => window.renderHarness.reset('# Source\n\n[go](folder/a(b).md#章节) and \\[[escaped]]\n\nend'));
  await expect(page.locator('[data-slot="0"] [data-preview-link]')).toHaveCount(1);
  await page.locator('[data-slot="0"] [data-preview-link]').click();
  expect(await page.evaluate(() => window.renderHarness.links)).toEqual(['0:folder/a(b).md#章节']);
});

test('source mode stays in source mode when navigating to a formula', async ({ page }) => {
  const raw = '# Start\n\n$$x^2$$ ^eq-a\n\nend';
  await page.evaluate(raw => window.renderHarness.reset(raw), raw);
  await page.evaluate(() => window.renderHarness.mode(0, 'source'));
  const result = await page.evaluate(() => window.renderHarness.navigate(0, { fragment: '^eq-a' }));
  expect(result.status).toBe('opened');
  await expect(page.locator('[data-slot="0"] [data-mode="source"]')).toBeVisible();
  await expect(page.locator('[data-slot="0"] .cm-navigation-target')).toContainText('$$x^2$$');
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(raw);
});

test.describe('workspace navigation', () => {
  test.beforeEach(async ({ page }) => {
    const contents: Record<string, string> = { 'a.md': '# Start\n\n[[#End]] and [[b#Other]]\n\n' + 'padding\n\n'.repeat(55) + '# End\n\nfinish', 'b.md': '# Other\n\nbody' };
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/vault-identity') return route.fallback();
      if (url.pathname === '/api/files/content') {
        const path = url.searchParams.get('path')!;
        return route.fulfill({ json: { path, content: contents[path] ?? '', revision: 'fixture', vault: 'browser-fixture' } });
      }
      if (url.pathname === '/api/resolve') {
        const target = url.searchParams.get('target') ?? '';
        return route.fulfill({ json: { path: target.startsWith('b') ? 'b.md' : 'a.md', status: 'resolved' } });
      }
      if (url.pathname === '/api/property-types') return route.fulfill({ json: { types: {} } });
      if (url.pathname === '/api/backlinks') return route.fulfill({ json: { backlinks: [] } });
      return route.fulfill({ json: { enabled: false, hits: [], matches: [] } });
    });
    await page.evaluate(async () => {
      const module = (path: string) => import(path);
      const storeUrls = [...new Set(performance.getEntriesByType('resource')
        .map(entry => entry.name).filter(name => new URL(name).pathname === '/src/lib/store.ts'))];
      if (storeUrls.length !== 1) throw new Error(`Expected one loaded workspace store module, got ${JSON.stringify(storeUrls)}`);
      const { useStore } = await module(storeUrls[0]);
      useStore.setState({ activePath: null, tabs: [], history: [], histIndex: -1, rightTabs: [], rightActiveId: null, rightOpen: true });
      await window.renderHarness.workspace('a.md');
      (window as any).navigationStore = useStore;
    });
    await expect(page.locator('.workspace .cm-content')).toContainText('Start');
    expect(await page.evaluate(() => (window as any).navigationStore.getState().activePath)).toBe('a.md');
  });

  test('back and forward restore same-note and cross-note selection without adding entries', async ({ page }) => {
    await page.locator('.workspace [data-preview-link="#End"]').click();
    await expect(page.locator('.workspace .cm-navigation-target')).toContainText('End');
    expect(await page.evaluate(() => (window as any).navigationStore.getState().history.length)).toBe(2);
    await page.evaluate(() => (window as any).navigationStore.getState().goBack());
    await expect.poll(() => page.evaluate(async () => {
      const module = (path: string) => import(path); const { captureLocation } = await module('/src/lib/fragmentNavigation.ts'); return captureLocation('a.md').anchor;
    })).toBe(0);
    await page.evaluate(() => (window as any).navigationStore.getState().goForward());
    await expect.poll(() => page.evaluate(async () => {
      const module = (path: string) => import(path); const { captureLocation } = await module('/src/lib/fragmentNavigation.ts'); return captureLocation('a.md').anchor;
    })).toBeGreaterThan(400);
    await page.evaluate(() => (window as any).navigationStore.getState().openWikilink('b#Other', 'a.md'));
    await expect(page.locator('.workspace .cm-content')).toContainText('Other');
    await page.evaluate(() => (window as any).navigationStore.getState().goBack());
    await expect(page.locator('.workspace .cm-content')).toContainText('End');
    expect(await page.evaluate(() => (window as any).navigationStore.getState().history.length)).toBe(3);
  });

  test('modifier opens a separate sidebar view and reuses its identity for following links', async ({ page }) => {
    await page.locator('.workspace [data-preview-link="#End"]').click({ modifiers: ['Control'] });
    const sidebar = page.locator('[data-sidebar-tab] .cm-content');
    await expect(sidebar).toContainText('End');
    expect(await page.evaluate(() => (window as any).navigationStore.getState().activePath)).toBe('a.md');
    const id = await page.evaluate(() => (window as any).navigationStore.getState().rightActiveId);
    await page.evaluate(async id => {
      const store = (window as any).navigationStore.getState(); await store.openWikilink('b#Other', 'a.md', { viewId: 'sidebar:' + id });
    }, id);
    await expect(sidebar).toContainText('Other');
    expect(await page.evaluate(() => (window as any).navigationStore.getState().rightActiveId)).toBe(id);
    expect(await page.evaluate(() => (window as any).navigationStore.getState().activePath)).toBe('a.md');
  });
  test('rapid back-forward keeps one history branch and restores the destination mode', async ({ page }) => {
    await page.evaluate(() => (window as any).navigationStore.getState().setViewMode('reading'));
    await expect(page.locator('.workspace [data-mode="reading"]')).toBeVisible();
    await page.evaluate(() => (window as any).navigationStore.getState().openWikilink('b#Other', 'a.md'));
    await page.evaluate(() => {
      const state = (window as any).navigationStore.getState(); state.goBack(); state.goForward();
    });
    await expect(page.locator('.workspace .cm-content')).toContainText('Other');
    await expect.poll(() => page.evaluate(() => (window as any).navigationStore.getState().histIndex)).toBe(1);
    expect(await page.evaluate(() => (window as any).navigationStore.getState().history.length)).toBe(2);
    await page.evaluate(() => (window as any).navigationStore.getState().setViewMode('live'));
    await expect(page.locator('.workspace [data-mode="live"]')).toBeVisible();
    await page.evaluate(() => (window as any).navigationStore.getState().goBack());
    await expect(page.locator('.workspace [data-mode="reading"]')).toBeVisible();
    await expect(page.locator('.workspace .cm-content')).toContainText('Start');
  });
});
