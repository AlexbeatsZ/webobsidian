import { test, expect } from './test';
import type { Page } from '@playwright/test';

async function workspace(page: Page, source: string, reading = false) {
  const saved: string[] = [];
  let raw = source, revision = 0;
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname === '/api/vault-identity') return route.fallback();
    if (url.pathname === '/api/writing') return route.fulfill({ json: {
      version: 1, migration: 'fixture', latex: { loadSnippetsFromFile: false, loadSnippetVariablesFromFile: false,
        snippets: '[]', snippetVariables: '{}' }, hotkeys: {},
      linter: { lintOnSave: true, customRegexes: [{ find: '，', replace: ',', flags: 'g', enabled: true }] },
    } });
    if (url.pathname === '/api/files/content') {
      if (request.method() === 'PUT') { raw = request.postDataJSON().content; saved.push(raw); revision++; }
      return route.fulfill({ json: { path: url.searchParams.get('path') ?? 'note.md', content: raw,
        revision: String(revision), vault: 'browser-fixture' } });
    }
    if (url.pathname === '/api/plugins/adapter') return route.fulfill({ json: {
      stat: { type: 'file', ctime: 1, mtime: 1, size: raw.length },
    } });
    if (url.pathname === '/api/property-types') return route.fulfill({ json: { types: {} } });
    return route.fulfill({ json: { hits: [], matches: [], backlinks: ['ref.md'], enabled: false } });
  });
  await page.goto('/__render-test');
  await page.waitForFunction(() => Boolean(window.renderHarness));
  await page.evaluate(async reading => {
    const load = (path: string) => import(path);
    const [store, plugins, writing] = await Promise.all([
      load('/src/lib/store.ts'), load('/src/lib/plugins.ts'), load('/src/lib/writing/config.ts'),
    ]);
    await writing.ensureWriting();
    const files = ['note.md', 'target.md', 'ref.md'];
    const tree = { name: 'Fixture', path: '', type: 'folder', children: files.map(path => ({ name: path, path, type: 'file' })) };
    plugins.sharedApp.vault.sync(tree);
    store.useStore.setState({ tree, filePaths: files, tabs: [], activePath: null, viewMode: reading ? 'reading' : 'live',
      rightOpen: true, rightPanel: 'properties', rightActiveId: null });
    await window.renderHarness.workspace('note.md');
  }, reading);
  await expect(page.locator('.cm-note-footer')).toBeAttached();
  return saved;
}

test('dm display snippets highlight while typing without Enter or leaving the formula', async ({ page }) => {
  await page.route('**/api/writing', route => route.fulfill({ json: {
    version: 1, migration: 'fixture',
    latex: { loadSnippetsFromFile: false, loadSnippetVariablesFromFile: false,
      snippets: '[{trigger:"dm", replacement:"$$$0$$", options:"tA"}]', snippetVariables: '{}' },
    linter: {}, hotkeys: {},
  } }));
  await page.goto('/__render-test');
  await page.waitForFunction(() => Boolean(window.renderHarness));
  await page.evaluate(async () => {
    const { ensureWriting } = await import('/src/lib/writing/config.ts');
    await ensureWriting();
    window.renderHarness.reset('\n\nFollowing text $y$');
  });
  await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe('\n\nFollowing text $y$');
  await page.evaluate(async () => {
    window.renderHarness.cursor(0, 0); window.renderHarness.focus(0);
    const { getActiveEditor } = await import('/src/lib/activeEditor.ts');
    const { StateEffect } = await import('/node_modules/.vite/deps/@codemirror_state.js');
    const { nativeWritingExtensions } = await import('/src/lib/writing/extensions.ts');
    getActiveEditor()!.dispatch({ effects: StateEffect.appendConfig.of(nativeWritingExtensions()) });
  });
  await page.keyboard.type('dm');
  await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe('$$$$\n\nFollowing text $y$');
  await expect(page.locator('[data-slot="0"] .cm-tex-delimiter')).toHaveCount(2);
  await page.keyboard.type('x+1');
  await expect(page.locator('[data-slot="0"] .cm-tex-variable')).toHaveText('x');
  await expect(page.locator('[data-slot="0"] .cm-tex-number')).toHaveText('1');
  await expect(page.locator('[data-slot="0"] .cm-math-edit-preview svg')).toHaveCount(1);
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe('$$x+1$$\n\nFollowing text $y$');
});

test('quoted display preview excludes quote source and retains the single containing quote rule', async ({ page }) => {
  await page.goto('/__render-test');
  await page.waitForFunction(() => Boolean(window.renderHarness));
  const source = '> $$\n> x+1\n> $$\n\nTail';
  await page.evaluate(source => window.renderHarness.reset(source), source);
  await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe(source);
  await page.evaluate(source => window.renderHarness.cursor(0, source.indexOf('x') + 1), source);
  await expect(page.locator('[data-slot="0"] .cm-math-edit-preview svg')).toHaveCount(1);
  const styles = await page.locator('[data-slot="0"] .cm-math-edit-preview').evaluate(node => {
    const rules: string[] = [];
    for (let element: Element | null = node; element && !element.classList.contains('cm-content'); element = element.parentElement) {
      for (const pseudo of ['::before', '::after']) {
        const style = getComputedStyle(element, pseudo);
        if (style.content !== 'none' && parseFloat(style.borderRightWidth) > 0) rules.push(element.className + pseudo);
      }
    }
    return rules;
  });
  expect(styles).toEqual(['md-container md-quote::before']);
  await expect(page.locator('[data-slot="0"] .cm-math-edit-preview .md-quote')).toHaveCount(0);
  await expect(page.locator('[data-slot="0"] .cm-math-edit-preview')).not.toContainText('>');
});

test('properties edit the same source from the sidebar and links occur at the document end and sidebar', async ({ page }, info) => {
  const original = '---\nstatus: before\nuntouched: "keep" # comment\n---\n\nBody [[target]]\n';
  await workspace(page, original);
  const sidebar = page.locator('.note-properties');
  const value = sidebar.locator('.prop-row').filter({ has: page.locator('.prop-key', { hasText: /^status$/ }) }).locator('.prop-val-input');
  await value.fill('after');
  await value.press('Tab');
  const read = () => page.evaluate(async () => (await import('/src/lib/documents.ts')).documents.get('note.md')!.snapshot.raw);
  await expect.poll(read).toBe(original.replace('status: before', 'status: after'));
  await expect(page.locator('.cm-content .prop-row').filter({ hasText: 'status' })).toContainText('after');
  const footer = page.locator('.cm-note-footer');
  await expect(footer).toContainText('ref');
  await expect(footer).toContainText('target');
  const geometry = await footer.evaluate(node => ({
    top: node.getBoundingClientRect().top,
    contentBottom: node.parentElement!.querySelector('.cm-content')!.getBoundingClientRect().bottom,
  }));
  expect(geometry.top).toBeGreaterThanOrEqual(geometry.contentBottom);
  await page.screenshot({ path: info.outputPath('properties-and-document-links.png') });
  await page.getByRole('button', { name: '出链', exact: true }).click();
  await expect(page.locator('.right-sidebar')).toContainText('target');
  await page.evaluate(async () => (await import('/src/lib/documents.ts')).documents.get('note.md')!.undo());
  await expect.poll(read).toBe(original);
});

test('manual Save formats configured rules even when the active view is reading', async ({ page }) => {
  const saved = await workspace(page, '# Note\n\nbefore，after\n', true);
  await page.evaluate(async () => {
    const { sharedApp } = await import('/src/lib/plugins.ts');
    await sharedApp.commands.execute('save');
  });
  expect(saved.at(-1)).toBe('# Note\n\nbefore,after\n');
  await expect(page.locator('.cm-content')).toContainText('before,after');
});

test('macOS settings closes from its left red control', async ({ page }, info) => {
  await workspace(page, '# Note\n');
  await page.route(/\/api\/settings\/?(?:\?.*)?$/, route => route.fulfill({ json: {
    vault: { path: '/fixture', allowedRoots: ['/fixture'], trash: '.trash', attachmentDir: 'attachments' }, ui: {},
    git: { enabled: false }, sync: { enabled: false },
  } }));
  await page.evaluate(async () => {
    const load = (path: string) => import(path);
    const [React, ReactDOM, settings, store] = await Promise.all([
      load('/node_modules/.vite/deps/react.js'), load('/node_modules/.vite/deps/react-dom_client.js'),
      load('/src/components/Settings.tsx'), load('/src/lib/store.ts'),
    ]);
    (window as any).webobsidianDesktop = { isDesktop: true, platform: 'darwin' };
    store.useStore.getState().setSettings(true);
    const host = document.createElement('div'); document.body.append(host);
    const h = (React.default ?? React).createElement;
    (ReactDOM.createRoot ?? ReactDOM.default.createRoot)(host).render(h(settings.default));
  });
  const close = page.getByRole('button', { name: '关闭设置', exact: true });
  await expect(close).toHaveCSS('background-color', 'rgb(255, 95, 87)');
  const position = await close.evaluate(node => ({
    left: node.getBoundingClientRect().left,
    headerLeft: node.parentElement!.getBoundingClientRect().left,
    size: node.getBoundingClientRect().width,
  }));
  expect(position.left - position.headerLeft).toBe(12);
  expect(position.size).toBe(12);
  await page.getByRole('dialog').screenshot({ path: info.outputPath('macos-settings-close.png') });
  await close.click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
