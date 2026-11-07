import { test, expect } from './test';
import { makePdfFixture } from './fixtures/pdf';

test.setTimeout(120000);

test('collection sidebar folds file/heading trees, returns to the cover and shares bounded source thumbnails', async ({ page }, testInfo) => {
  const folder = 'Sidebar Book', pdf = makePdfFixture({ pages: 12 });
  const files = Array.from({ length: 10 }, (_, index) => ({ path: `${folder}/Chapter ${index + 1}.md`, title: `Chapter ${index + 1}`,
    kind: 'markdown', size: 4000, headings: [{ text: `Section ${index + 1}`, level: 1 }, { text: `Detail ${index + 1}`, level: 2 }, { text: `Leaf ${index + 1}`, level: 3 }] }));
  const pdfFiles = Array.from({ length: 8 }, (_, index) => ({ path: `${folder}/Slides ${index + 1}.pdf`, title: `Slides ${index + 1}`, kind: 'pdf', size: pdf.length, headings: [] }));
  const collection = { path: folder, title: 'A continuous book', revision: 'fixture', streams: [{ id: 'text', title: 'MD', files }, { id: 'pdf', title: 'PDF', files: pdfFiles }] };
  const reads: string[] = [];
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/vault-identity' || url.pathname === '/api/writing') return route.fallback();
    if (url.pathname.replace(/\/$/, '') === '/api/uistate') return route.fulfill({ json: {} });
    if (url.pathname === '/api/files/content') {
      const path = url.searchParams.get('path')!; reads.push(path);
      if (path.endsWith('.pdf')) return route.fulfill({ contentType: 'application/pdf', body: pdf });
      const index = files.findIndex(file => file.path === path) + 1;
      return route.fulfill({ json: { path, content: `# Section ${index}\n\n## Detail ${index}\n\n### Leaf ${index}\n\nBefore\n\n$$\nx^2\n$$\n\n` + 'A regular body paragraph.\n\n'.repeat(120) + '\nAfter', revision: 'initial', vault: 'browser-fixture' } });
    }
    if (url.pathname === '/api/property-types') return route.fulfill({ json: { types: {} } });
    return route.fulfill({ json: { hits: [], matches: [], backlinks: [], outgoing: [], enabled: false } });
  });
  await page.goto('/__render-test'); await page.waitForFunction(() => Boolean(window.renderHarness));
  await page.evaluate(async ({ folder, collection }) => {
    const load = (path: string) => import(path);
    const [React, ReactDOM, { default: Workspace }, { default: RightSidebar }, store, { publishVirtualDocuments }, { useVirtualReading }, { getPdfSession }] = await Promise.all([
      load('/node_modules/.vite/deps/react.js'), load('/node_modules/.vite/deps/react-dom_client.js'), load('/src/components/Workspace.tsx'),
      load('/src/components/RightSidebar.tsx'), load('/src/lib/store.ts'), load('/src/lib/virtualDocuments.ts'), load('/src/lib/virtualReading.ts'), load('/src/lib/pdf/react.ts'),
    ]);
    document.getElementById('root')!.hidden = true;
    const host = document.createElement('div'); host.id = 'virtual-sidebar-fixture'; host.style.cssText = 'position:fixed;inset:0'; document.body.append(host);
    const tree = { name: 'Fixture', path: '', type: 'folder', children: [{ name: folder, path: folder, type: 'folder', virtualDocument: collection }] };
    await store.useStore.getState().loadUiState(); publishVirtualDocuments(tree);
    store.useStore.setState({ tree, rightOpen: true, rightPanel: 'outline', rightActiveId: null, rightTabs: [], viewMode: 'live' });
    await store.useStore.getState().openFile(folder);
    (window as any).virtualSidebar = { store: store.useStore, getPdfSession };
    function Probe() { (window as any).virtualSidebar.reader = useVirtualReading(folder, 'main'); return null; }
    const h = (React.default ?? React).createElement;
    (ReactDOM.createRoot ?? ReactDOM.default.createRoot)(host).render(h('div', { className: 'app theme-dark' }, h(Workspace), h(RightSidebar, { open: true }), h(Probe)));
  }, { folder, collection });
  const host = page.locator('#virtual-sidebar-fixture'), outline = host.getByRole('navigation', { name: '连续文档大纲' });
  await expect(outline.getByRole('button', { name: '目录', exact: true })).toBeVisible({ timeout: 30000 });
  const first = outline.locator('[data-outline-source]').first();
  await first.getByRole('button', { name: '收起 Detail 1', exact: true }).click();
  await expect(first.getByRole('button', { name: 'Leaf 1', exact: true })).toHaveCount(0);
  await first.getByRole('button', { name: '收起 Chapter 1', exact: true }).click();
  await expect(first.getByRole('button', { name: 'Section 1', exact: true })).toHaveCount(0);
  await first.getByRole('button', { name: '展开 Chapter 1', exact: true }).click();
  await expect(first.getByRole('button', { name: '展开 Detail 1', exact: true })).toBeVisible();
  await first.getByRole('button', { name: '展开 Detail 1', exact: true }).click();
  await expect(first.getByRole('button', { name: 'Leaf 1', exact: true })).toBeVisible();
  await outline.getByRole('button', { name: 'Chapter 8', exact: true }).click();
  const source = host.locator(`[data-virtual-source="${files[7].path}"]`);
  await expect(source.locator('.cm-content')).toContainText('Section 8', { timeout: 30000 });
  await host.getByRole('button', { name: '缩略图', exact: true }).click();
  const thumbnails = host.getByRole('region', { name: '连续文档缩略图' });
  await expect(thumbnails.getByRole('navigation', { name: '缩略图文件索引' }).getByRole('button', { name: 'Chapter 8', exact: true })).toHaveAttribute('aria-current', 'location');
  const slider = thumbnails.getByRole('slider', { name: '文档缩略图位置' });
  await expect(slider).toHaveAttribute('data-ready', 'true', { timeout: 15000 });
  await expect(thumbnails.locator('.markdown-minimap canvas')).toHaveAttribute('data-paint-count', /[1-9]/);
  await slider.click({ position: { x: 60, y: 150 } });
  await expect.poll(() => page.evaluate(() => (window as any).virtualSidebar.reader.getSnapshot().target?.line)).toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath('virtual-markdown-sidebar.png') });
  expect(reads.filter(path => path.endsWith('.md')).length).toBeLessThanOrEqual(8);
  await thumbnails.getByRole('navigation', { name: '缩略图文件索引' }).getByRole('button', { name: '目录', exact: true }).click();
  await expect(thumbnails.getByRole('button', { name: '目录缩略图', exact: true })).toBeVisible();
  await expect.poll(() => host.locator('.virtual-document-scroll').evaluate(node => node.scrollTop)).toBe(0);
  await host.getByRole('button', { name: '大纲', exact: true }).click();
  await page.evaluate(() => { (window as any).virtualSidebar.reader.selectStream('pdf'); });
  await outline.getByRole('button', { name: 'Slides 5', exact: true }).click();
  const pdfSource = host.locator(`[data-virtual-source="${pdfFiles[4].path}"]`);
  await expect(pdfSource.locator('[data-page-number="1"] .pdf-page-surface')).toHaveClass(/is-ready/, { timeout: 30000 });
  await expect(host.locator('[data-mounted="true"] [data-virtual-loading]')).toHaveCount(0);
  const sharedSession = await page.evaluate(path => {
    const fixture = (window as any).virtualSidebar;
    fixture.bodyPdf = fixture.getPdfSession(path, 'virtual:main');
    return fixture.bodyPdf?.getSnapshot().status;
  }, pdfFiles[4].path);
  expect(sharedSession).toBe('ready');
  const readsBeforePanel = reads.filter(path => path.endsWith('.pdf'));
  await host.getByRole('button', { name: '缩略图', exact: true }).click();
  await expect(thumbnails.locator('[data-thumbnail-page="2"]')).toBeVisible({ timeout: 30000 });
  await expect(thumbnails.locator('[data-thumbnail-page="2"] canvas')).toBeAttached();
  // Opening the sidebar reuses the loaded body resource; visited-file totals
  // depend on the reader's prefetch windows and are evidence, not concurrency.
  expect(reads.filter(path => path.endsWith('.pdf'))).toEqual(readsBeforePanel);
  expect(await page.evaluate(path => {
    const fixture = (window as any).virtualSidebar;
    return fixture.getPdfSession(path, 'virtual:main') === fixture.bodyPdf;
  }, pdfFiles[4].path)).toBe(true);
  await thumbnails.locator('[data-thumbnail-page="2"]').click();
  await expect(host.locator(`[data-virtual-source="${pdfFiles[4].path}"] [data-page-number="2"] .pdf-page-surface`)).toBeInViewport();
  await expect.poll(() => thumbnails.locator('canvas').count()).toBeLessThan(8);
  await expect.poll(() => host.locator('[data-mounted="true"]').count()).toBeLessThanOrEqual(6);
  await testInfo.attach('virtual-thumbnail-resources.json', { body: JSON.stringify({ readsBeforePanel, readsAfterPanelAndNavigation: reads.filter(path => path.endsWith('.pdf')),
    mountedSources: await host.locator('[data-mounted="true"]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-virtual-source'))) }), contentType: 'application/json' });
  await page.screenshot({ path: testInfo.outputPath('virtual-pdf-sidebar.png') });
});
