import { test, expect } from './test';
import { makePdfFixture } from './fixtures/pdf';

test.beforeEach(async ({ page, expectedErrors }) => {
  expectedErrors.length = 0;
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname === '/api/vault-identity' || url.pathname === '/api/writing') return route.fallback();
    if (url.pathname.replace(/\/$/, '') === '/api/uistate') return route.fulfill({ json: request.method() === 'PUT' ? { ok: true } : {} });
    if (url.pathname === '/api/files/content') {
      const path = url.searchParams.get('path');
      if (path?.endsWith('.pdf')) {
        const bytes = makePdfFixture({ pages: path === 'large.pdf' || path === 'mixed.pdf' ? 80 : 6, outline: path !== 'no-outline.pdf',
          documentScript: 'globalThis.__pdfScriptExecuted = true; app.alert("PDF script should not execute");',
          pageSizes: path === 'mixed.pdf' ? Array.from({ length: 80 }, (_, index) => index === 68 ? [612, 1584] as const : index === 69 ? [792, 612] as const : [612, 792] as const) : [] });
        return route.fulfill({ contentType: 'application/pdf', headers: { 'Accept-Ranges': 'bytes' }, body: request.method() === 'HEAD' ? Buffer.alloc(0) : bytes });
      }
      return route.fulfill({ json: { path, content: '# Note\n\noriginal note', revision: 'initial', vault: 'browser-fixture' } });
    }
    if (url.pathname === '/api/property-types') return route.fulfill({ json: { types: {} } });
    return route.fulfill({ json: { hits: [], enabled: false, matches: [], backlinks: [] } });
  });
  await page.goto('/__render-test');
  await page.waitForFunction(() => Boolean(window.renderHarness));
  await page.evaluate(async () => {
    const load = (path: string) => import(path);
    const [React, ReactDOM, { default: Workspace }, { default: SidebarTabPanels }, store, { documents }, maintenance,
      pdfReact, { default: PdfOutlinePanel }, { default: PdfThumbnailsPanel }] = await Promise.all([
      load('/node_modules/.vite/deps/react.js'), load('/node_modules/.vite/deps/react-dom_client.js'),
      load('/src/components/Workspace.tsx'), load('/src/components/SidebarTabPanels.tsx'), load('/src/lib/store.ts'),
      load('/src/lib/documents.ts'), load('/src/lib/vaultMaintenance.ts'),
      load('/src/lib/pdf/react.ts'), load('/src/components/PdfOutlinePanel.tsx'), load('/src/components/PdfThumbnailsPanel.tsx'),
    ]);
    document.getElementById('root')!.hidden = true;
    const host = document.createElement('div'); host.id = 'pdf-fixture'; document.body.append(host);
    host.style.cssText = 'position:fixed;inset:0';
    const tree = { name: 'Fixture', path: '', type: 'folder', children: ['note.md', 'paper.pdf', 'archive.zip'].map(path => ({ name: path, path, type: 'file' })) };
    await store.useStore.getState().loadUiState();
    store.useStore.setState({ tree, filePaths: ['note.md', 'paper.pdf', 'archive.zip'], pdfToolbarOpen: true });
    maintenance.bindVaultMaintenance(new EventTarget());
    await store.useStore.getState().openFile('note.md');
    const h = (React.default ?? React).createElement;
    function PdfPanels() {
      const activePath = store.useStore((state: any) => state.activePath);
      const session = pdfReact.useMainPdfSession(activePath);
      return session ? h('aside', { id: 'pdf-right-panels', style: { width: 220, flex: 'none', display: 'flex', flexDirection: 'column', minHeight: 0 } },
        h(PdfOutlinePanel, { session }), h('div', { style: { flex: 1, minHeight: 0 } }, h(PdfThumbnailsPanel, { session }))) : null;
    }
    (ReactDOM.createRoot ?? ReactDOM.default.createRoot)(host).render(h('div', { className: 'app', style: { height: '100%', display: 'flex', flexDirection: 'row' } },
      h(Workspace), h(SidebarTabPanels, { side: 'right', open: true }), h(PdfPanels)));
    (window as any).pdfFixture = { ...store, documents, pdfReact };
  });
  await expect(page.locator('#pdf-fixture .main-pane .cm-content')).toContainText('original note');
});

test('opening a PDF keeps layout saves and note sessions healthy without a nested workspace', async ({ page }) => {
  const layouts: { path: string; vault: string | undefined }[] = [];
  page.on('request', request => {
    if (request.url().includes('/api/uistate/') && request.method() === 'PUT')
      layouts.push({ path: request.postDataJSON().activePath, vault: request.headers()['x-vault-identity'] });
  });
  await page.evaluate(async () => {
    const fixture = (window as any).pdfFixture;
    fixture.note = fixture.documents.get('note.md');
    await fixture.useStore.getState().openFile('paper.pdf');
  });
  const viewer = page.locator('#pdf-fixture .pdf-viewer');
  await expect(viewer.locator('.pdf-page-surface.is-ready').first()).toBeVisible();
  await expect(viewer.getByRole('textbox', { name: 'PDF 页码' })).toHaveValue('1');
  await expect(page.locator('#pdf-fixture iframe')).toHaveCount(0);
  await expect(page.locator('#pdf-fixture .main-pane .cm-editor')).toHaveCount(0);
  const result = await page.evaluate(async () => {
    const fixture = (window as any).pdfFixture;
    await fixture.flushWorkspaceState();
    const missingSession = !fixture.documents.get('paper.pdf');
    const before = fixture.useStore.getState();
    await before.openFile('note.md');
    return { missingSession, stale: before.vaultSessionStale, toast: before.toast,
      sameSession: fixture.documents.get('note.md') === fixture.note, raw: fixture.note.snapshot.raw };
  });
  expect(result).toEqual({ missingSession: true, stale: false, toast: '', sameSession: true, raw: '# Note\n\noriginal note' });
  expect(layouts).toContainEqual({ path: 'paper.pdf', vault: 'browser-fixture' });
  expect(await page.evaluate(() => (window as any).__pdfScriptExecuted)).toBeUndefined();
  await expect(page.locator('#pdf-fixture .main-pane .cm-content')).toContainText('original note');
});

test('rapid document/query replacement destroys old work and keeps newest search results', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void;
  const loading = new Promise<void>(resolve => { started = resolve; });
  await page.route('**/api/files/content?**', async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('path') !== 'slow.pdf' || route.request().method() !== 'GET') return route.fallback();
    started(); await gate;
    await route.fulfill({ contentType: 'application/pdf', body: makePdfFixture({ pages: ['old response needle'] }) }).catch(() => {});
  });
  await page.evaluate(() => (window as any).pdfFixture.useStore.getState().openFile('slow.pdf'));
  await loading;
  await page.evaluate(() => (window as any).pdfFixture.useStore.getState().openFile('paper.pdf'));
  release();
  await expect(page.locator('.pdf-viewer')).toHaveAttribute('data-pdf-path', 'paper.pdf');
  await expect(page.locator('.pdf-viewer .pdf-page-surface.is-ready').first()).toBeVisible();
  const search = page.getByRole('searchbox', { name: '搜索 PDF' });
  await search.click(); await search.fill('needle alpha'); await search.fill('needle beta');
  await expect(page.locator('.pdf-search [role="status"]')).toHaveText('1/3');
  await expect(page.locator('[data-thumbnail-page="1"]')).not.toHaveClass(/has-matches/);
  await expect(page.locator('[data-thumbnail-page="2"]')).toHaveClass(/has-matches/);
  await search.fill('');
  await expect(page.locator('.pdf-match')).toHaveCount(0);
  await expect(page.locator('.pdf-thumbnail.has-matches')).toHaveCount(0);
  await page.evaluate(() => (window as any).pdfFixture.useStore.getState().openFile('note.md'));
  await expect(page.locator('.pdf-viewer')).toHaveCount(0);
  await expect(page.locator('#pdf-right-panels')).toHaveCount(0);
  await expect(page.locator('#pdf-fixture canvas')).toHaveCount(0);
});

test('sidebar and restored split binary files cannot enter writable document sessions or discard another draft', async ({ page }) => {
  await page.evaluate(async () => {
    const fixture = (window as any).pdfFixture, session = fixture.documents.get('note.md');
    session.setRawText('# Note\n\nunsaved draft');
    fixture.release = session.holdEdits();
    await fixture.useStore.getState().openRightTab('markdown', { file: 'paper.pdf' }, 'pdf-side');
    fixture.useStore.setState({ splitPath: 'archive.zip' });
  });
  await expect(page.locator('[data-sidebar-tab="pdf-side"] .pdf-page-surface.is-ready').first()).toBeVisible();
  await expect(page.locator('#pdf-fixture .split-pane .attachment-view')).toContainText('此附件不支持文本编辑');
  const result = await page.evaluate(async () => {
    const fixture = (window as any).pdfFixture;
    const errors = [];
    for (const path of ['paper.pdf', 'archive.zip']) {
      try { await fixture.documents.open(path); } catch (error: any) { errors.push(error.status); }
    }
    await fixture.flushWorkspaceState();
    const session = fixture.documents.get('note.md');
    const result = { errors, ids: fixture.documents.snapshots().map((snapshot: any) => snapshot.id),
      dirty: session.snapshot.dirty, raw: session.snapshot.raw, stale: fixture.useStore.getState().vaultSessionStale };
    fixture.release();
    return result;
  });
  expect(result).toEqual({ errors: [415, 415], ids: ['note.md'], dirty: true, raw: '# Note\n\nunsaved draft', stale: false });
});

test('same-path sidebar focus cannot redirect main outline and closing it retains the main PDF', async ({ page }) => {
  await page.evaluate(async () => {
    const fixture = (window as any).pdfFixture;
    await fixture.useStore.getState().openFile('paper.pdf');
  });
  await expect(page.locator('.main-pane .pdf-page-surface.is-ready').first()).toBeVisible();
  await page.evaluate(async () => {
    const fixture = (window as any).pdfFixture;
    fixture.main = fixture.pdfReact.getMainPdfSession('paper.pdf');
    await fixture.useStore.getState().openRightTab('markdown', { file: 'paper.pdf' }, 'same-pdf');
  });
  const sidebar = page.locator('[data-sidebar-tab="same-pdf"]');
  await expect(sidebar.locator('.pdf-page-surface.is-ready').first()).toBeVisible();
  await sidebar.getByRole('textbox', { name: 'PDF 页码' }).click();
  await page.getByRole('button', { name: /Chapter Two/ }).click();
  await expect(page.locator('.main-pane').getByRole('textbox', { name: 'PDF 页码' })).toHaveValue('2');
  await expect(sidebar.getByRole('textbox', { name: 'PDF 页码' })).toHaveValue('1');
  expect(await page.evaluate(async () => {
    const fixture = (window as any).pdfFixture;
    fixture.sidebar = fixture.pdfReact.getActivePdfSession();
    await fixture.useStore.getState().closeRightTab('same-pdf');
    return fixture.pdfReact.getMainPdfSession('paper.pdf') === fixture.main;
  })).toBe(true);
  await expect(sidebar).toHaveCount(0);
  expect(await page.evaluate(() => {
    const fixture = (window as any).pdfFixture;
    return [fixture.sidebar.getSnapshot().status, fixture.main.getSnapshot().status];
  })).toEqual(['destroyed', 'ready']);
  await page.evaluate(() => (window as any).pdfFixture.useStore.getState().openFile('note.md'));
  await expect(page.locator('#pdf-right-panels')).toHaveCount(0);
});

test('a genuine Vault conflict still invalidates the workspace and hides attachment actions', async ({ page, expectedErrors }) => {
  expectedErrors.push('409 (Conflict)');
  await page.evaluate(() => (window as any).pdfFixture.useStore.getState().openFile('paper.pdf'));
  await expect(page.locator('#pdf-fixture .pdf-page-surface.is-ready').first()).toBeVisible();
  await page.route('**/api/uistate/', route => route.fulfill({ status: 409, json: { error: 'Vault 已切换', code: 'VAULT_CHANGED' } }));
  const message = await page.evaluate(async () => {
    const fixture = (window as any).pdfFixture;
    fixture.messages = [];
    const notify = fixture.useStore.getState().notify;
    fixture.useStore.setState({ notify: (text: string, duration?: number) => { fixture.messages.push(text); notify(text, duration); } });
    fixture.useStore.getState().toggleLeft();
    try { await fixture.flushWorkspaceState(); } catch (error) { return String(error); }
  });
  expect(message).toContain('Vault 已切换');
  await expect(page.locator('#pdf-fixture [role="alert"]').filter({ hasText: 'Vault 已切换' })).toBeVisible();
  await expect(page.locator('#pdf-fixture .pdf-viewer canvas')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).pdfFixture.messages.some((text: string) => text.includes('工作区保存失败')))).toBe(true);
});

test('native outline, named destinations, page thumbnails and search share page state and hit boxes', async ({ page }) => {
  await page.evaluate(() => (window as any).pdfFixture.useStore.getState().openFile('paper.pdf'));
  await expect(page.getByRole('navigation', { name: 'PDF 内置目录' })).toBeVisible();
  await page.getByRole('button', { name: 'Chapter Two' }).click();
  await expect(page.getByRole('textbox', { name: 'PDF 页码' })).toHaveValue('2');
  await expect(page.locator('.pdf-thumbnail[aria-current="page"]')).toHaveAttribute('data-thumbnail-page', '2');
  await page.getByRole('searchbox', { name: '搜索 PDF' }).click();
  await expect(page.getByRole('searchbox', { name: '搜索 PDF' })).toBeFocused();
  await page.getByRole('searchbox', { name: '搜索 PDF' }).fill('needle beta');
  await expect(page.locator('.pdf-search [role="status"]')).toHaveText('1/3');
  await expect(page.locator('.pdf-thumbnail.has-matches')).toHaveCount(3);
  await expect(page.locator('.pdf-viewer [data-pdf-page="2"] .pdf-match')).toHaveCount(1);
  await expect(page.locator('.pdf-thumbnails [data-pdf-page="2"] .pdf-match')).toHaveCount(1);
  const body = await page.locator('.pdf-viewer [data-pdf-page="2"] .pdf-match').getAttribute('data-match-box');
  expect(await page.locator('.pdf-thumbnails [data-pdf-page="2"] .pdf-match').getAttribute('data-match-box')).toBe(body);
  await page.getByRole('button', { name: '下一个 PDF 匹配' }).click();
  await expect(page.getByRole('textbox', { name: 'PDF 页码' })).toHaveValue('4');
  await page.locator('[data-thumbnail-page="6"]').click();
  await expect(page.getByRole('textbox', { name: 'PDF 页码' })).toHaveValue('6');
});

test('distant page jumps stay on target when newly visible preceding pages have different sizes', async ({ page }) => {
  await page.evaluate(() => (window as any).pdfFixture.useStore.getState().openFile('mixed.pdf'));
  await expect(page.locator('.pdf-viewer .pdf-page-surface.is-ready').first()).toBeVisible();
  await page.getByRole('textbox', { name: 'PDF 页码' }).fill('70');
  await page.getByRole('textbox', { name: 'PDF 页码' }).press('Enter');
  await expect(page.locator('.pdf-viewer [data-pdf-page="70"].is-ready')).toBeVisible();
  await expect.poll(async () => page.evaluate(() => {
    const viewport = document.querySelector('.pdf-pages')!.getBoundingClientRect();
    const page = document.querySelector('.pdf-viewer [data-page-number="70"]')!.getBoundingClientRect();
    return Math.abs(page.top - viewport.top - 20);
  })).toBeLessThan(28);
  await expect(page.getByRole('textbox', { name: 'PDF 页码' })).toHaveValue('70');
});

test('80 page PDF keeps canvases bounded, jumps to distant pages and reports absent native outline', async ({ page }) => {
  await page.evaluate(() => (window as any).pdfFixture.useStore.getState().openFile('large.pdf'));
  await expect(page.locator('.pdf-viewer .pdf-page-surface.is-ready').first()).toBeVisible();
  await expect(page.locator('.pdf-page-slot')).toHaveCount(80);
  expect(await page.locator('#pdf-fixture canvas').count()).toBeLessThan(18);
  await page.getByRole('textbox', { name: 'PDF 页码' }).fill('70');
  await page.getByRole('textbox', { name: 'PDF 页码' }).press('Enter');
  await expect(page.locator('.pdf-viewer [data-pdf-page="70"].is-ready')).toBeVisible();
  expect(await page.locator('#pdf-fixture canvas').count()).toBeLessThan(18);
  await page.getByRole('searchbox', { name: '搜索 PDF' }).fill('on page 70');
  await expect(page.locator('.pdf-search [role="status"]')).toHaveText('1/1');
  await expect(page.locator('[data-thumbnail-page="70"]')).toContainText('1 个匹配');
  await page.evaluate(() => (window as any).pdfFixture.useStore.getState().openFile('no-outline.pdf'));
  await expect(page.locator('#pdf-right-panels')).toContainText('此 PDF 没有内置目录');
});
