import { test, expect } from './test';
import type { Page } from '@playwright/test';
import { makePdfFixture } from './fixtures/pdf';

const pdf = makePdfFixture({ pages: 8 });

async function openFixture(page: Page) {
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname === '/api/vault-identity' || url.pathname === '/api/writing') return route.fallback();
    if (url.pathname.replace(/\/$/, '') === '/api/uistate') return route.fulfill({ json: request.method() === 'PUT' ? { ok: true } : {} });
    if (url.pathname === '/api/settings/hotkeys') {
      if (request.method() === 'PUT') {
        const body = request.postDataJSON();
        return route.fulfill({ json: { version: 1, bindings: { [body.command]: body.bindings }, imported: [], migration: '', vault: body.vault } });
      }
      return route.fulfill({ json: { version: 1, bindings: {}, imported: [], migration: '', vault: '' } });
    }
    if (url.pathname === '/api/files/content') {
      const path = url.searchParams.get('path');
      if (path?.endsWith('.pdf')) return route.fulfill({ contentType: 'application/pdf', headers: { 'Accept-Ranges': 'bytes' },
        body: request.method() === 'HEAD' ? Buffer.alloc(0) : pdf });
      return route.fulfill({ json: { path, content: '# Note\n\nordinary text', revision: 'initial', vault: 'browser-fixture' } });
    }
    if (url.pathname === '/api/property-types') return route.fulfill({ json: { types: {} } });
    return route.fulfill({ json: { hits: [], matches: [], backlinks: [], enabled: false } });
  });
  await page.goto('/__render-test');
  await page.waitForFunction(() => Boolean(window.renderHarness));
  await page.evaluate(async () => {
    const load = (path: string) => import(path);
    const [React, ReactDOM, tabs, workspace, store, documents, plugins, pdfReact, search, sidebar] = await Promise.all([
      load('/node_modules/.vite/deps/react.js'), load('/node_modules/.vite/deps/react-dom_client.js'),
      load('/src/components/WorkspaceTabs.tsx'), load('/src/components/Workspace.tsx'), load('/src/lib/store.ts'),
      load('/src/lib/documents.ts'), load('/src/lib/plugins.ts'), load('/src/lib/pdf/react.ts'), load('/src/lib/search.ts'),
      load('/src/components/SidebarTabPanels.tsx'),
    ]);
    document.getElementById('root')!.hidden = true;
    const host = document.createElement('div');
    host.id = 'pdf-toolbar-fixture';
    host.style.cssText = 'position:fixed;inset:0';
    document.body.append(host);
    await store.useStore.getState().loadUiState();
    const tree = { name: 'Fixture', path: '', type: 'folder', children: ['note.md', 'paper.pdf'].map(path => ({ name: path, path, type: 'file' })) };
    store.useStore.setState({
      tree, filePaths: ['note.md', 'paper.pdf'], tabs: [], activePath: null, splitPath: null, rightOpen: false, pdfToolbarOpen: false,
    });
    plugins.sharedApp.vault.sync(tree);
    const h = (React.default ?? React).createElement;
    (ReactDOM.createRoot ?? ReactDOM.default.createRoot)(host).render(h('div', { className: 'app theme-light', style: { height: '100%' } },
      h(tabs.default), h(workspace.default),
      h('aside', { className: 'right-sidebar', style: { position: 'fixed', top: 32, right: 0, width: 280, height: 500, zIndex: 10 } },
        h(sidebar.default, { side: 'right', open: true }))));
    (window as any).pdfToolbarFixture = { store: store.useStore, documents, commands: plugins.sharedApp.commands, pdf: pdfReact, search };
  });
}

const main = (page: Page) => page.locator('#pdf-toolbar-fixture .main-pane');
const toolbar = (page: Page) => main(page).locator('.pdf-toolbar');
const toggle = (page: Page) => page.getByRole('button', { name: '显示/隐藏 PDF 工具栏' });
const rightToggle = (page: Page) => page.getByRole('button', { name: '折叠/展开右侧边栏' });

test.beforeEach(async ({ page }) => { await openFixture(page); });

test('button sits immediately left of the sidebar toggle and the toolbar defaults hidden', async ({ page }) => {
  await page.evaluate(() => (window as any).pdfToolbarFixture.store.getState().openFile('paper.pdf'));
  await expect(main(page).locator('.pdf-page-surface.is-ready').first()).toBeVisible();
  await expect(toolbar(page)).toHaveCount(0);
  const button = toggle(page);
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  expect(await button.getAttribute('class')).toContain('tab-ctl');
  const [pdfBox, sidebarBox] = await Promise.all([button.boundingBox(), rightToggle(page).boundingBox()]);
  expect(pdfBox).not.toBeNull();
  expect(sidebarBox).not.toBeNull();
  expect(pdfBox!.x + pdfBox!.width).toBeLessThanOrEqual(sidebarBox!.x + 1);
  expect(rightToggle(page)).toHaveAttribute('aria-expanded', 'false');
});

test('toggle is an overlay below the titlebar and preserves layout, scroll, pages, search, page and zoom', async ({ page }) => {
  await page.evaluate(() => (window as any).pdfToolbarFixture.store.getState().openFile('paper.pdf'));
  await expect(main(page).locator('.pdf-page-surface.is-ready').first()).toBeVisible();
  const tabBar = page.locator('#pdf-toolbar-fixture .tab-bar');
  const pages = main(page).locator('.pdf-pages');
  const before = await page.evaluate(async () => {
    const fixture = (window as any).pdfToolbarFixture;
    const element = document.querySelector('#pdf-toolbar-fixture .main-pane .pdf-pages') as HTMLElement;
    element.scrollTop = 420;
    await new Promise(resolve => setTimeout(resolve, 100));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    fixture.main = fixture.pdf.getMainPdfSession('paper.pdf');
    const state = fixture.main.getSnapshot();
    return { scroll: element.scrollTop, height: element.clientHeight, top: element.getBoundingClientRect().top,
      pageTop: document.querySelector('#pdf-toolbar-fixture .main-pane .pdf-page-slot')!.getBoundingClientRect().top,
      canvases: document.querySelectorAll('#pdf-toolbar-fixture .main-pane canvas').length,
      page: state.currentPage, status: state.status };
  });
  await toggle(page).click();
  await expect(toolbar(page)).toBeVisible();
  await expect(toolbar(page)).toHaveClass(/is-overlay/);
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
  const [toolbarBox, tabBox] = await Promise.all([toolbar(page).boundingBox(), tabBar.boundingBox()]);
  expect(toolbarBox!.y).toBeGreaterThanOrEqual(tabBox!.y + tabBox!.height - 1);
  const after = await page.evaluate(() => {
    const fixture = (window as any).pdfToolbarFixture;
    const element = document.querySelector('#pdf-toolbar-fixture .main-pane .pdf-pages') as HTMLElement;
    const state = fixture.main.getSnapshot();
    return { scroll: element.scrollTop, height: element.clientHeight, top: element.getBoundingClientRect().top,
      pageTop: document.querySelector('#pdf-toolbar-fixture .main-pane .pdf-page-slot')!.getBoundingClientRect().top,
      canvases: document.querySelectorAll('#pdf-toolbar-fixture .main-pane canvas').length,
      page: state.currentPage, status: state.status, same: fixture.main === fixture.pdf.getMainPdfSession('paper.pdf') };
  });
  expect(after).toMatchObject({ scroll: before.scroll, height: before.height, top: before.top, pageTop: before.pageTop,
    page: before.page, status: before.status, same: true });
  expect(after.canvases).toBeGreaterThan(0);
  await toggle(page).click();
  await expect(toolbar(page)).toHaveCount(0);
  expect(await pages.evaluate(element => element.scrollTop)).toBe(before.scroll);
  await toggle(page).click();
  await expect(toolbar(page)).toBeVisible();

  await main(page).getByRole('button', { name: '放大 PDF' }).click();
  await expect(main(page).locator('.pdf-zoom')).toHaveText('125%');
  const search = main(page).getByRole('searchbox', { name: '搜索 PDF' });
  await search.fill('needle');
  await expect(main(page).locator('.pdf-search [role="status"]')).toHaveText('1/8');
  const pageNumber = main(page).getByRole('textbox', { name: 'PDF 页码' });
  await pageNumber.fill('3'); await pageNumber.press('Enter');
  await expect(pageNumber).toHaveValue('3');
  await toggle(page).click();
  await expect(toolbar(page)).toHaveCount(0);
  expect(await pages.evaluate(element => element.clientHeight)).toBe(before.height);
  await toggle(page).click();
  await expect(main(page).locator('.pdf-zoom')).toHaveText('125%');
  await expect(main(page).getByRole('searchbox', { name: '搜索 PDF' })).toHaveValue('needle');
  await expect(main(page).locator('.pdf-search [role="status"]')).toHaveText('1/8');
  await expect(main(page).getByRole('textbox', { name: 'PDF 页码' })).toHaveValue('3');
  await main(page).locator('.pdf-pages').click();
  await expect(toolbar(page)).toBeVisible();
  await toggle(page).click();
  await expect(toolbar(page)).toHaveCount(0);
  await page.mouse.move(640, 180);
  await page.mouse.move(640, 30);
  await page.waitForTimeout(250);
  await expect(toolbar(page)).toHaveCount(0);
  await page.locator('#pdf-toolbar-fixture .main-pane .pdf-pages').focus();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.closest('.pdf-toolbar') === null)).toBe(true);
});

test('native command is assignable, shares the button action and Ctrl+F reveals search without hiding while typing', async ({ page }) => {
  await page.evaluate(() => (window as any).pdfToolbarFixture.store.getState().openFile('paper.pdf'));
  await expect(main(page).locator('.pdf-page-surface.is-ready').first()).toBeVisible();
  expect(await page.evaluate(() => {
    const commands = (window as any).pdfToolbarFixture.commands;
    return { exists: !!commands.findCommand('pdf:toggle-toolbar'),
      defaults: commands.getDefaultHotkeys('pdf:toggle-toolbar').length,
      catalog: commands.hotkeyCatalog().some((command: any) => command.id === 'pdf:toggle-toolbar') };
  })).toEqual({ exists: true, defaults: 0, catalog: true });
  const shortcut = await page.evaluate(async () => {
    const fixture = (window as any).pdfToolbarFixture;
    await fixture.search.updateHotkeys('pdf:toggle-toolbar', [{ modifiers: ['Mod', 'Shift'], key: 'U' }]);
    const available = fixture.commands.canExecute('pdf:toggle-toolbar');
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
    const handled = fixture.commands.dispatchHotkey(new KeyboardEvent('keydown', {
      key: 'u', code: 'KeyU', ctrlKey: !mac, metaKey: mac, shiftKey: true, bubbles: true, cancelable: true,
    }));
    return { available, handled, open: fixture.store.getState().pdfToolbarOpen, bindings: fixture.commands.getHotkeys('pdf:toggle-toolbar') };
  });
  expect(shortcut).toEqual({ available: true, handled: true, open: true, bindings: [{ modifiers: ['Mod', 'Shift'], key: 'U' }] });
  await expect(toolbar(page)).toBeVisible();
  expect(await page.evaluate(() => (window as any).pdfToolbarFixture.store.getState().pdfToolbarOpen)).toBe(true);
  await toggle(page).click();
  await expect(toolbar(page)).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).pdfToolbarFixture.store.getState().pdfToolbarOpen)).toBe(false);
  expect(await page.evaluate(() => (window as any).pdfToolbarFixture.commands.executeCommandById('pdf:toggle-toolbar'))).toBe(true);
  await expect(toolbar(page)).toBeVisible();
  await toggle(page).click();
  await expect(toolbar(page)).toHaveCount(0);
  await main(page).locator('.pdf-pages').focus();
  await page.keyboard.press('Control+f');
  await expect(toolbar(page)).toBeVisible();
  const search = main(page).getByRole('searchbox', { name: '搜索 PDF' });
  await expect(search).toBeFocused();
  await page.keyboard.type('needle');
  await expect(toolbar(page)).toBeVisible();
  await expect(search).toHaveValue('needle');
  await expect(main(page).locator('.pdf-search [role="status"]')).toHaveText('1/8');
  await page.evaluate(() => (window as any).pdfToolbarFixture.commands.executeCommandById('pdf:toggle-toolbar'));
  await expect(toolbar(page)).toHaveCount(0);
  await page.evaluate(() => (window as any).pdfToolbarFixture.commands.executeCommandById('pdf:toggle-toolbar'));
  await expect(toolbar(page)).toBeVisible();
  await expect(main(page).getByRole('searchbox', { name: '搜索 PDF' })).toHaveValue('needle');
  await expect(main(page).locator('.pdf-search [role="status"]')).toHaveText('1/8');
});

test('narrow touch layout keeps the control, split and sidebar views do not steal main ownership', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 740 });
  await page.evaluate(() => (window as any).pdfToolbarFixture.store.getState().openFile('paper.pdf'));
  await expect(main(page).locator('.pdf-page-surface.is-ready').first()).toBeVisible();
  const buttonBox = await toggle(page).boundingBox();
  expect(buttonBox!.width).toBeGreaterThanOrEqual(44);
  await toggle(page).click();
  await expect(toolbar(page)).toBeVisible();
  expect((await toolbar(page).boundingBox())!.width).toBeLessThanOrEqual(420);
  await expect(main(page).getByRole('textbox', { name: 'PDF 页码' })).toBeVisible();
  await page.evaluate(() => (window as any).pdfToolbarFixture.store.getState().openToSide('note.md', 'right'));
  const split = page.locator('#pdf-toolbar-fixture .split-pane');
  await expect(split.locator('.cm-editor')).toBeVisible();
  await expect(split.locator('.pdf-toolbar')).toHaveCount(0);
  await expect(toolbar(page)).toBeVisible();
  await page.evaluate(() => (window as any).pdfToolbarFixture.store.getState().openRightTab('markdown', { file: 'paper.pdf' }, 'pdf-side'));
  const side = page.locator('[data-sidebar-tab="pdf-side"]');
  await expect(side.locator('.pdf-page-surface.is-ready').first()).toBeVisible();
  await expect(side.locator('.pdf-toolbar')).toBeVisible();
  await expect(side.locator('.pdf-toolbar')).not.toHaveClass(/is-overlay/);
  await toggle(page).click();
  await expect(toolbar(page)).toHaveCount(0);
  await expect(split.locator('.pdf-toolbar')).toHaveCount(0);
  await expect(side.locator('.pdf-toolbar')).toBeVisible();
  await page.evaluate(() => (window as any).pdfToolbarFixture.store.getState().toggleRight());
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
  await page.evaluate(() => (window as any).pdfToolbarFixture.store.getState().toggleRight());
  await toggle(page).click();
  await expect(toolbar(page)).toBeVisible();
  await page.evaluate(() => (window as any).pdfToolbarFixture.store.getState().openFile('note.md'));
  await expect(toggle(page)).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).pdfToolbarFixture.store.getState().pdfToolbarOpen)).toBe(true);
  await page.evaluate(() => (window as any).pdfToolbarFixture.store.getState().openFile('paper.pdf'));
  await expect(toolbar(page)).toBeVisible();
});
