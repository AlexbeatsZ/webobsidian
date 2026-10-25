import { expect, test } from './test';
import { emptyHotkeys } from '../../packages/search-core/src/hotkeys';

test.beforeEach(async ({ page }) => {
  const entries = [
    { path: '02笔记/化学/量子化学.md', title: '量子化学', tags: ['化学/物理', '笔记'] },
    { path: '02笔记/量子旧版.md', title: '量子旧版', tags: ['化学', '笔记', '旧版/已归档'] },
    { path: '01项目/化学实验.md', title: '化学实验', tags: ['化学', '项目'] },
    { path: '01项目/计算笔记.md', title: '计算笔记', tags: ['计算', '笔记'] },
  ].map(entry => ({ ...entry, kind: 'file', aliases: [], headings: ['反应记录'] }));
  await page.route('**/api/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/vault-identity') return route.fallback();
    if (pathname === '/api/settings/hotkeys') return route.fulfill({ json: { ...emptyHotkeys(), vault: 'browser-fixture' } });
    return route.fulfill({ json: pathname === '/api/catalog' ? { entries }
      : pathname === '/api/settings/' ? { search: { chinese: {} } }
      : pathname === '/api/writing' ? { version: 1, latex: { snippets: '[]' }, linter: {}, hotkeys: {} }
      : { hits: [], matches: [], enabled: false } });
  });
  await page.goto('/__render-test');
  await page.waitForFunction(() => Boolean(window.renderHarness));
  await page.evaluate(async () => {
    const module = (path: string) => import(path);
    const [React, ReactDOM, { default: Palette }, { useStore }, search, { sharedApp }] = await Promise.all([
      module('/node_modules/.vite/deps/react.js'), module('/node_modules/.vite/deps/react-dom_client.js'),
      module('/src/components/CommandPalette.tsx'), module('/src/lib/store.ts'), module('/src/lib/search.ts'), module('/src/lib/plugins.ts'),
    ]);
    await search.refreshSearch();
    document.getElementById('root')!.hidden = true;
    document.body.classList.add('theme-dark');
    const host = document.createElement('div'); host.className = 'theme-dark'; document.body.append(host);
    const open = (mode = 'files') => useStore.setState({ paletteMode: mode, paletteOpen: true, paletteRightTab: null });
    const created: string[] = [];
    useStore.setState({ recent: ['02笔记/化学/量子化学.md', '01项目/化学实验.md'], createNote: async (path: string) => { created.push(path); } });
    sharedApp.commands.register({ id: 'palette-fixture', name: '解锁/锁定', hotkeys: [{ modifiers: ['Ctrl'], key: 'L' }], callback: () => {} });
    for (let i = 0; i < 45; i++) sharedApp.commands.register({ id: `palette-${i}`, name: `工作区命令 ${String(i).padStart(2, '0')}`, callback: () => {} });
    (window as any).paletteHarness = { store: useStore, open, created };
    (ReactDOM.createRoot ?? ReactDOM.default.createRoot)(host).render((React.default ?? React).createElement(Palette));
    open();
  });
  await expect(page.getByRole('dialog', { name: '快速打开' })).toBeVisible();
});

test('one input combines names, pinyin, multiple required tags and excluded descendants', async ({ page }) => {
  const input = page.locator('.palette-input');
  await input.fill('量子 #化学 #笔记 -#旧版');
  await expect(page.locator('.palette-file-item')).toHaveCount(1);
  await expect(page.locator('.palette-result-title')).toHaveText('量子化学');
  await expect(page.locator('.palette-result-path')).toHaveText('02笔记/化学/量子化学.md');
  await expect(page.locator('.palette-tag')).toHaveText(['化学/物理', '笔记']);
  await input.fill('lz #化学 -#旧版');
  await expect(page.locator('.palette-file-item')).toHaveCount(1);
  await input.fill('path:01项目 #化学');
  await expect(page.locator('.palette-result-title')).toHaveText('化学实验');
  await input.fill('body:反应 #化学');
  await expect(page.locator('.palette-empty')).toHaveText('正文内容请在左侧搜索中查找');
});

test('file rows match the compact reference in dark, light and narrow windows', async ({ page }) => {
  await expect(page.locator('.palette-history-key')).toHaveText(['1', '2']);
  await expect(page.locator('.palette-footer')).toContainText('#标签 · -#排除');
  const title = page.locator('.palette-result-title').first(), path = page.locator('.palette-result-path').first();
  expect((await title.boundingBox())!.y).toBeLessThan((await path.boundingBox())!.y);
  expect(await page.locator('.palette-modal').evaluate(el => getComputedStyle(el).fontFamily)).toContain('Segoe UI');
  await page.locator('.palette-modal').screenshot({ path: test.info().outputPath('files-dark.png') });
  await page.evaluate(() => document.querySelectorAll('.theme-dark').forEach(el => { el.classList.remove('theme-dark'); el.classList.add('theme-light'); }));
  await page.locator('.palette-modal').screenshot({ path: test.info().outputPath('files-light.png') });
  await page.setViewportSize({ width: 390, height: 720 });
  const bounds = (await page.locator('.palette-modal').boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await page.locator('.palette-modal').screenshot({ path: test.info().outputPath('files-mobile.png') });
});

test('commands show actual shortcuts, preserve actions and scroll keyboard selection', async ({ page }) => {
  await page.evaluate(() => (window as any).paletteHarness.open('commands'));
  await expect(page.getByRole('dialog', { name: '命令面板' })).toBeVisible();
  await page.locator('.palette-modal').screenshot({ path: test.info().outputPath('commands-all-dark.png') });
  await page.locator('.palette-input').fill('解锁');
  await expect(page.locator('.palette-shortcut')).toHaveText('Ctrl + L');
  await page.locator('.palette-modal').screenshot({ path: test.info().outputPath('commands-dark.png') });
  await page.locator('.palette-input').fill('工作区命令');
  for (let i = 0; i < 35; i++) await page.keyboard.press('ArrowDown');
  const selected = (await page.locator('[role=option][aria-selected=true]').boundingBox())!;
  const list = (await page.locator('.palette-list').boundingBox())!;
  expect(selected.y).toBeGreaterThanOrEqual(list.y);
  expect(selected.y + selected.height).toBeLessThanOrEqual(list.y + list.height + 1);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('Shift Enter creates only a plain valid title and never uses tag filters as names', async ({ page }) => {
  await page.locator('.palette-input').fill('新文件 #化学');
  await page.keyboard.press('Shift+Enter');
  expect(await page.evaluate(() => (window as any).paletteHarness.created)).toEqual([]);
  await page.locator('.palette-input').fill('新文件');
  await page.keyboard.press('Shift+Enter');
  expect(await page.evaluate(() => (window as any).paletteHarness.created)).toEqual(['新文件.md']);
});
