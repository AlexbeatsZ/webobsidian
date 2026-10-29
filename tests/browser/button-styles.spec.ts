import { test, expect } from './test';

test.beforeEach(async ({ page }) => {
  await page.goto('/__render-test');
  await page.waitForFunction(() => Boolean(window.renderHarness));
  await page.evaluate(async () => {
    const load = (path: string) => import(path);
    const [React, ReactDOM, { UserscriptSettings }, { ButtonComponent, SearchComponent }, { default: TagOperationsHost }, { ItemView }] = await Promise.all([
      load('/node_modules/.vite/deps/react.js'), load('/node_modules/.vite/deps/react-dom_client.js'),
      load('/src/components/UserscriptSettings.tsx'), load('/src/lib/obsidian/ui.ts'), load('/src/components/TagOperationsHost.tsx'), load('/src/lib/obsidian/workspace.ts'),
    ]);
    const requests: { action: string; payload: any }[] = [];
    const metadata = { name: 'Fixture script', version: '1.0', description: '', grants: [], connects: [], matches: ['https://example.com/*'],
      includes: [], excludes: [], excludeMatches: [], requires: [], resources: [], runAt: 'document-end', noframes: true, raw: {} };
    const snapshot = { vault: 'browser-fixture', migration: 'fixture', autoUpdate: false, intervalHours: 24, statuses: [], scripts: [{
      id: 'fixture', revision: 1, source: '// fixture', metadata, requires: [], resources: {}, warnings: [], enabled: false, autoUpdate: false,
      importedAt: 0, updatedAt: 0, approved: { grants: [], connects: [], pageWorld: false, rules: metadata },
      update: { state: 'available', candidateId: 'next', pending: { source: '// next', metadata: { ...metadata, version: '2.0' }, warnings: [] } },
    }] };
    const fixture = { requests, blockImport: false, release: () => {} };
    (window as any).buttonFixture = fixture;
    (window as any).webobsidianDesktop = { userscripts: { subscribe: () => () => {}, request: async (action: string, payload: any) => {
      requests.push({ action, payload });
      if (action === 'list') return snapshot;
      if (action === 'paths') return { store: '.obsidian/webobsidian/userscripts/store.json' };
      if (action === 'menus') return [{ guestId: 1, scriptId: 'fixture', id: 'menu', label: 'Fixture menu', url: 'https://example.com/' }];
      if (action === 'import' && fixture.blockImport) await new Promise<void>(resolve => { fixture.release = resolve; });
    } } };
    document.getElementById('root')!.hidden = true;
    const host = document.createElement('div');
    host.id = 'button-fixture'; host.style.cssText = 'position:fixed;inset:12px;display:flex;justify-content:center'; document.body.append(host);
    const element = (React.default ?? React).createElement;
    (ReactDOM.createRoot ?? ReactDOM.default.createRoot)(host).render(element('div', { className: 'settings-modal' },
      element('nav', { className: 'settings-nav' }, element('button', {}, 'Navigation')),
      element('div', { className: 'settings-content' }, element(UserscriptSettings), element('div', { id: 'adapter-buttons' })),
      element('button', { className: 'tool-btn', 'aria-label': 'Fixture toolbar' }, '×'), element(TagOperationsHost)));
    await new Promise<void>(resolve => {
      const mounted = () => document.getElementById('adapter-buttons') ? resolve() : requestAnimationFrame(mounted);
      mounted();
    });
    const adapters = document.getElementById('adapter-buttons')!;
    new ButtonComponent(adapters).setButtonText('Adapter secondary');
    new ButtonComponent(adapters).setButtonText('Adapter primary').setCta();
    new ButtonComponent(adapters).setButtonText('Adapter warning').setWarning();
    new ButtonComponent(adapters).setButtonText('Adapter disabled').setDisabled(true);
    new SearchComponent(adapters).setValue('Fixture search');
    const view = new ItemView({}); view.addAction('x', 'Adapter view action', () => {}); adapters.append(view.containerEl);
    const submit = document.createElement('input'); submit.type = 'submit'; submit.value = 'Native submit'; adapters.append(submit);
  });
  await expect(page.getByRole('heading', { name: 'Fixture script' })).toBeVisible();
});

for (const theme of ['dark', 'light']) {
  test(`${theme}: native file picker and every ordinary userscript/adapter button share one visual contract`, async ({ page }) => {
    await page.evaluate(theme => { document.body.classList.remove('theme-dark', 'theme-light'); document.body.classList.add(`theme-${theme}`); }, theme);
    const styles = await page.evaluate(() => {
      const keys = ['appearance', 'fontFamily', 'fontSize', 'lineHeight', 'minHeight', 'paddingTop', 'paddingRight', 'borderTopWidth', 'borderRadius', 'backgroundColor', 'color'];
      const read = (element: Element, pseudo?: string) => { const style = getComputedStyle(element, pseudo); return Object.fromEntries(keys.map(key => [key, (style as any)[key]])); };
      const reference = document.querySelector('[aria-label="内置浏览器用户脚本"] button')!;
      const buttons = Array.from(document.querySelectorAll('[aria-label="内置浏览器用户脚本"] button, #adapter-buttons .secondary:not(.danger), #adapter-buttons input[type="submit"]'));
      return { reference: read(reference), buttons: buttons.map(button => ({ text: button.textContent, styles: read(button) })),
        file: read(document.querySelector('input[type="file"]')!, '::file-selector-button') };
    });
    expect(styles.file).toEqual(styles.reference);
    for (const button of styles.buttons) expect(button.styles, button.text ?? '').toEqual(styles.reference);
    await expect(page.getByRole('button', { name: 'Adapter disabled', exact: true })).toHaveCSS('opacity', '0.5');
    await expect(page.getByRole('button', { name: 'Fixture toolbar' })).toHaveCSS('border-top-width', '0px');
    await expect(page.getByRole('button', { name: 'Navigation', exact: true })).toHaveCSS('text-align', 'left');
    await page.screenshot({ path: test.info().outputPath(`buttons-${theme}.png`) });
  });
}

test('secondary/primary/warning buttons share focus and disabled handling without disabled hover', async ({ page }) => {
  const secondary = page.getByRole('button', { name: 'Adapter secondary', exact: true });
  const before = await secondary.evaluate(button => getComputedStyle(button).backgroundColor);
  await secondary.hover();
  expect(await secondary.evaluate(button => getComputedStyle(button).backgroundColor)).not.toBe(before);
  const primary = page.getByRole('button', { name: 'Adapter primary', exact: true });
  const warning = page.getByRole('button', { name: 'Adapter warning', exact: true });
  expect(await primary.evaluate(button => getComputedStyle(button).backgroundColor)).not.toBe(before);
  expect(await warning.evaluate(button => getComputedStyle(button).backgroundColor)).not.toBe(before);
  await secondary.focus(); await page.keyboard.press('Tab');
  await expect(primary).toBeFocused(); await expect(primary).toHaveCSS('outline-style', 'solid');
  for (const button of [secondary, primary, warning]) {
    await button.evaluate(element => { (element as HTMLButtonElement).disabled = true; });
    await page.mouse.move(0, 0);
    const background = await button.evaluate(element => getComputedStyle(element).backgroundColor);
    await button.hover({ force: true });
    await expect(button).toHaveCSS('background-color', background);
    await expect(button).toHaveCSS('opacity', '0.5');
    await expect(button).toHaveCSS('cursor', 'default');
  }
});

test('native file import still reads source, allows the same file twice and rejects oversized files', async ({ page }) => {
  const input = page.getByLabel('从文件导入用户脚本');
  const file = { name: 'fixture.user.js', mimeType: 'text/javascript', buffer: Buffer.from('// fixture import') };
  await input.setInputFiles(file); await input.setInputFiles(file);
  await expect.poll(() => page.evaluate(() => (window as any).buttonFixture.requests.filter((request: any) => request.action === 'import')))
    .toEqual([{ action: 'import', payload: { source: '// fixture import' } }, { action: 'import', payload: { source: '// fixture import' } }]);
  await input.setInputFiles({ ...file, buffer: Buffer.alloc(8 * 1024 * 1024 + 1) });
  await expect(page.getByRole('alert')).toContainText('文件超过 8 MiB');
  expect(await page.evaluate(() => (window as any).buttonFixture.requests.filter((request: any) => request.action === 'import').length)).toBe(2);
});

test('busy fieldset disables both the native picker and every userscript action consistently', async ({ page }) => {
  await page.evaluate(() => { (window as any).buttonFixture.blockImport = true; });
  await page.getByLabel('从文件导入用户脚本').setInputFiles({ name: 'busy.user.js', mimeType: 'text/javascript', buffer: Buffer.from('// busy') });
  const section = page.getByRole('region', { name: '内置浏览器用户脚本' });
  await expect(section).toHaveAttribute('aria-busy', 'true');
  expect(await page.getByLabel('从文件导入用户脚本').evaluate(input => getComputedStyle(input, '::file-selector-button').cursor)).toBe('default');
  for (const button of await section.locator('button, input[type="file"]').all()) {
    await expect(button).toBeDisabled(); await expect(button).toHaveCSS('opacity', '0.5');
  }
  await page.evaluate(() => (window as any).buttonFixture.release());
  await expect(section).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByLabel('从文件导入用户脚本')).toBeEnabled();
});

test('ordinary prompt and tag dialog actions reuse the same button family', async ({ page }) => {
  await page.evaluate(async () => {
    const load = (path: string) => import(path);
    const { promptInput } = await load('/src/lib/obsidian/ui.ts');
    void promptInput({}, 'Fixture prompt', '').catch(() => {});
  });
  await expect(page.getByRole('button', { name: '确定', exact: true })).toHaveClass(/\bbtn\b/);
  await page.keyboard.press('Escape');
  await page.evaluate(async () => {
    const load = (path: string) => import(path);
    const { openTagOperation } = await load('/src/lib/tags/actions.ts');
    openTagOperation({ scope: { kind: 'vault' } });
  });
  const dialog = page.getByRole('dialog');
  for (const button of await dialog.locator('button').all()) await expect(button).toHaveClass(/\bbtn\b/);
});

test('plugin search/view icon actions retain the shared toolbar style inside settings', async ({ page }) => {
  const clear = page.getByTitle('清除搜索', { exact: true });
  const action = page.getByTitle('Adapter view action', { exact: true });
  for (const button of [clear, action]) {
    await expect(button).toHaveClass('tool-btn');
    await expect(button).toHaveCSS('width', '28px');
    await expect(button).toHaveCSS('border-top-width', '0px');
    await expect(button).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  }
  await clear.click(); await expect(page.locator('#adapter-buttons input[type="search"]')).toHaveValue('');
});
