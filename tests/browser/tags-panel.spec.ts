import { test, expect } from './test';

// Disposable fixture: every tag API response is mocked; no Vault is read or written.
test.beforeEach(async ({ page }) => {
  const previews: unknown[] = [], applies: unknown[] = [];
  await page.route('**/api/tags', route => route.fulfill({ json: {
    preferences: { batchEnabled: true, wranglerEnabled: true },
    tags: [
      { tag: 'chemistry', count: 2, directCount: 2, pages: [] },
      { tag: 'physics', count: 3, directCount: 1, pages: [] },
      { tag: 'physics/wave', count: 2, directCount: 2, pages: [] },
      { tag: 'physik', count: 1, directCount: 1, pages: [] },
    ],
  } }));
  await page.route('**/api/tags/preview', route => {
    const body = route.request().postDataJSON(); previews.push(body);
    return route.fulfill({ json: { id: '00000000-0000-4000-8000-000000000001', expiresAt: Date.now() + 60_000, operation: body.operation,
      files: [{ path: 'a.md', status: 'ready', local: false, revision: 'r1', changes: [{ from: 0, to: 7, insert: '#physics' }], expected: ['#physik'] }],
      collisions: body.operation.kind === 'merge' ? [{ from: 'physik', to: 'physics' }] : [] } });
  });
  await page.route('**/api/tags/apply', route => { applies.push(route.request().postDataJSON()); return route.fulfill({ json: { path: 'a.md', status: 'written' } }); });
  await page.route('**/api/tags/cancel', route => route.fulfill({ json: { ok: true } }));
  await page.exposeFunction('tagRequests', () => ({ previews, applies }));
  await page.goto('/__render-test');
  await page.waitForFunction(() => Boolean(window.renderHarness));
  await page.evaluate(async () => {
    const React = await import('/node_modules/.vite/deps/react.js');
    const ReactDOM = await import('/node_modules/.vite/deps/react-dom_client.js');
    const createRoot = ReactDOM.createRoot ?? ReactDOM.default.createRoot;
    const { default: TagsPanel } = await import('/src/components/TagsPanel.tsx');
    const { default: Host } = await import('/src/components/TagOperationsHost.tsx');
    const { default: ContextMenu } = await import('/src/components/ContextMenu.tsx');
    const h = (React.default ?? React).createElement;
    document.getElementById('root')!.hidden = true;
    const host = document.createElement('div'); host.className = 'app theme-dark'; host.style.cssText = 'width:300px'; document.body.append(host);
    createRoot(host).render(h('div', null, h(TagsPanel), h(Host), h(ContextMenu)));
  });
  await expect(page.getByRole('button', { name: 'physik', exact: true })).toBeVisible();
});

test('the tags panel has no separate batch manager and merges a multi-selection in place', async ({ page }) => {
  await expect(page.getByRole('button', { name: '批量修改标签' })).toHaveCount(0);
  await expect(page.getByRole('toolbar', { name: '所选标签操作' })).toHaveCount(0);
  await page.getByRole('button', { name: '多选', exact: true }).click();
  const bar = page.getByRole('toolbar', { name: '所选标签操作' });
  await expect(bar.getByRole('button', { name: '合并' })).toBeDisabled();
  await page.getByRole('button', { name: 'physik', exact: true }).click();
  await page.getByLabel('选择 #physics', { exact: true }).check();
  await expect(bar).toContainText('已选 2');
  await bar.getByRole('button', { name: '合并' }).click();
  const dialog = page.getByRole('dialog', { name: '合并 2 个标签' });
  // The selection is the source: no operation picker or tag input is asked again.
  await expect(dialog.locator('select')).toHaveCount(0);
  // The most used selected tag is the default target and its preview opens with the dialog.
  await expect(dialog.getByRole('radio', { name: '#physics' })).toBeChecked();
  await dialog.getByRole('radio', { name: '#physik' }).check();
  await dialog.getByRole('button', { name: '预览改动' }).click();
  await dialog.getByRole('radio', { name: '#physics' }).check();
  await dialog.getByRole('button', { name: '预览改动' }).click();
  await expect(dialog.getByRole('checkbox', { name: /确认合并/ })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('tags-merge-preview.png') });
  await dialog.getByRole('button', { name: '应用并保存 1 个文件' }).click();
  await expect(dialog.getByRole('status')).toContainText('保存 1 个文件');
  const requests = await page.evaluate(() => (window as any).tagRequests());
  expect(requests.previews.map((preview: any) => preview.operation)).toEqual([
    { kind: 'merge', tags: ['physics', 'physik'], to: 'physics', descendants: true },
    { kind: 'merge', tags: ['physics', 'physik'], to: 'physik', descendants: true },
    { kind: 'merge', tags: ['physics', 'physik'], to: 'physics', descendants: true },
  ]);
  expect(requests.applies).toEqual([expect.objectContaining({ path: 'a.md', confirmMerge: true })]);
  await page.screenshot({ path: test.info().outputPath('tags-merge.png') });
});

test('modifier clicks select without a mode, Escape clears, and rename edits the row in place', async ({ page }) => {
  await page.getByRole('button', { name: 'chemistry', exact: true }).click({ modifiers: ['Control'] });
  await page.getByRole('button', { name: 'physik', exact: true }).click({ modifiers: ['Shift'] });
  const bar = page.getByRole('toolbar', { name: '所选标签操作' });
  await expect(bar).toContainText('已选 4');
  await page.screenshot({ path: test.info().outputPath('tags-selection.png') });
  await page.getByRole('button', { name: 'physik', exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(bar).toHaveCount(0);
  await page.getByRole('button', { name: 'physik', exact: true }).dblclick();
  const input = page.getByLabel('重命名 #physik', { exact: true });
  await expect(input).toBeFocused();
  await input.fill('physics2');
  await input.press('Enter');
  const dialog = page.getByRole('dialog', { name: '重命名标签层级' });
  await expect(dialog.getByRole('button', { name: '应用并保存 1 个文件' })).toBeVisible();
  await expect(dialog.locator('select')).toHaveCount(0);
  expect((await page.evaluate(() => (window as any).tagRequests())).previews.at(-1).operation)
    .toEqual({ kind: 'rename', from: 'physik', to: 'physics2', descendants: true });
});

test('context menus act on the clicked tag in place or on the whole selection', async ({ page }) => {
  await page.getByRole('button', { name: 'physik', exact: true }).click({ button: 'right' });
  await page.getByText('重命名 #physik', { exact: true }).click();
  const input = page.getByLabel('重命名 #physik', { exact: true });
  await expect(input).toBeFocused();
  await input.press('Escape');
  await expect(input).toHaveCount(0);
  await page.getByRole('button', { name: 'chemistry', exact: true }).click({ modifiers: ['Control'] });
  await page.getByRole('button', { name: 'physik', exact: true }).click({ modifiers: ['Control'] });
  await page.getByRole('button', { name: 'physik', exact: true }).click({ button: 'right' });
  await expect(page.getByText('重命名 #physik', { exact: true })).toHaveCount(0);
  await page.getByText('删除所选 2 个标签…', { exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '删除 2 个标签' });
  await expect(dialog.locator('.native-tags-chips li')).toHaveText(['#chemistry', '#physik']);
  await expect(dialog.getByRole('button', { name: '应用并保存 1 个文件' })).toBeVisible();
});
