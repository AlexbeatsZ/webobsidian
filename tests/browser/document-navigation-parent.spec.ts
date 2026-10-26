import { test, expect } from './test';
import { makePdfFixture } from './fixtures/pdf';

test('right sidebar shares PDF navigation and bounded page rendering across file changes', async ({ page }, testInfo) => {
  const pdf = makePdfFixture({ pages: 60 });
  const plain = makePdfFixture({ pages: 2, outline: false });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname === '/api/vault-identity' || url.pathname === '/api/writing') return route.fallback();
    if (url.pathname.replace(/\/$/, '') === '/api/uistate') return route.fulfill({ json: request.method() === 'PUT' ? { ok: true } : {} });
    if (url.pathname === '/api/files/content') {
      const path = url.searchParams.get('path');
      if (path?.endsWith('.pdf')) return route.fulfill({ contentType: 'application/pdf', body: path === 'plain.pdf' ? plain : pdf });
      return route.fulfill({ json: { path, content: '# Kept note\n\n' + 'line\n'.repeat(200), revision: 'initial', vault: 'browser-fixture' } });
    }
    if (url.pathname === '/api/property-types') return route.fulfill({ json: { types: {} } });
    return route.fulfill({ json: { hits: [], matches: [], backlinks: [], enabled: false } });
  });
  await page.goto('/__render-test');
  await page.waitForFunction(() => Boolean(window.renderHarness));
  await page.evaluate(async () => {
    const load = (path: string) => import(path);
    const [React, ReactDOM, { default: Workspace }, { default: RightSidebar }, store, { documents }] = await Promise.all([
      load('/node_modules/.vite/deps/react.js'), load('/node_modules/.vite/deps/react-dom_client.js'),
      load('/src/components/Workspace.tsx'), load('/src/components/RightSidebar.tsx'), load('/src/lib/store.ts'), load('/src/lib/documents.ts'),
    ]);
    document.getElementById('root')!.hidden = true;
    const host = document.createElement('div'); host.id = 'parent-navigation'; host.style.cssText = 'position:fixed;inset:0'; document.body.append(host);
    await store.useStore.getState().loadUiState();
    store.useStore.setState({ tree: { name: 'Fixture', path: '', type: 'folder', children: ['note.md', 'paper.pdf', 'plain.pdf'].map(path => ({ name: path, path, type: 'file' })) },
      rightOpen: true, rightPanel: 'outline', rightTabs: [], rightActiveId: null });
    await store.useStore.getState().openFile('paper.pdf');
    const h = (React.default ?? React).createElement;
    (ReactDOM.createRoot ?? ReactDOM.default.createRoot)(host).render(h('div', { className: 'app theme-dark' }, h(Workspace), h(RightSidebar, { open: true })));
    (window as any).parentNavigation = { ...store, documents };
  });
  const host = page.locator('#parent-navigation');
  await expect(host.getByRole('button', { name: /Chapter Two/ })).toBeVisible();
  await host.getByRole('button', { name: /Chapter Two/ }).click();
  await expect(host.getByRole('textbox', { name: 'PDF 页码' })).toHaveValue('2');
  await host.getByRole('button', { name: '缩略图', exact: true }).click();
  await expect(host.locator('[data-thumbnail-page="2"]')).toHaveAttribute('aria-current', 'page');
  await expect.poll(() => host.locator('canvas').count()).toBeLessThan(20);
  await host.getByRole('searchbox', { name: '搜索 PDF' }).fill('needle');
  await expect(host.locator('.pdf-search [role="status"]')).toHaveText('1/60');
  await expect(host.locator('[data-thumbnail-page="2"] .pdf-match')).not.toHaveCount(0);
  const bodyMatch = host.locator('[data-page-number="2"] .pdf-match').first();
  const thumbnailMatch = host.locator('[data-thumbnail-page="2"] .pdf-match').first();
  await expect(bodyMatch).toHaveAttribute('data-match-box', await thumbnailMatch.getAttribute('data-match-box') ?? 'missing');
  await page.screenshot({ path: testInfo.outputPath('pdf-search-thumbnails.png') });
  await host.getByRole('searchbox', { name: '搜索 PDF' }).fill('');
  await expect(host.locator('.pdf-match')).toHaveCount(0);
  const pageNumber = host.getByRole('textbox', { name: 'PDF 页码' });
  await pageNumber.fill('50'); await pageNumber.press('Enter');
  await expect(host.locator('[data-thumbnail-page="50"]')).toHaveAttribute('aria-current', 'page');
  await expect(host.locator('[data-page-number="50"] canvas')).toBeVisible();
  await page.evaluate(async () => { await (window as any).parentNavigation.useStore.getState().openFile('plain.pdf'); });
  await host.getByRole('button', { name: '大纲', exact: true }).click();
  await expect(host).toContainText('此 PDF 没有内置目录');
  await page.evaluate(async () => { await (window as any).parentNavigation.useStore.getState().openFile('note.md'); });
  await expect(host.locator('.outline-item')).toContainText('Kept note');
  await host.getByRole('button', { name: '缩略图', exact: true }).click();
  await expect(host.locator('.markdown-minimap')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('markdown-minimap.png') });
  const result = await page.evaluate(async () => {
    const fixture = (window as any).parentNavigation;
    await fixture.flushWorkspaceState();
    return { stale: fixture.useStore.getState().vaultSessionStale, pdfSession: !!fixture.documents.get('paper.pdf') };
  });
  expect(result).toEqual({ stale: false, pdfSession: false });
  expect(errors).toEqual([]);
});
