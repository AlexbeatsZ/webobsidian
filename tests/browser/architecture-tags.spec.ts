import { test, expect } from './test';

test('a saved tag page reports index failure and retries opening without creating twice', async ({ page }) => {
  let creates = 0;
  await page.route('**/api/tags/page?*', route => route.fulfill({ json: {
    pages: [], suggestedPath: 'Tag.md', content: '---\naliases: ["#test"]\n---\n',
  } }));
  await page.route('**/api/tags/page', route => {
    creates++;
    return route.fulfill({ json: { path: 'Tag.md', indexing: { status: 'failed', path: 'Tag.md', error: 'fixture index failure' } } });
  });
  await page.goto('/__render-test');
  await page.waitForFunction(() => Boolean(window.renderHarness));
  await page.evaluate(async () => {
    const React = await import('/node_modules/.vite/deps/react.js');
    const ReactDOM = await import('/node_modules/.vite/deps/react-dom_client.js');
    const createRoot = ReactDOM.createRoot ?? ReactDOM.default.createRoot;
    const { default: Host } = await import('/src/components/TagOperationsHost.tsx');
    const { useStore } = await import('/src/lib/store.ts');
    const { openNativeTagPage } = await import('/src/lib/tags/actions.ts');
    let attempts = 0;
    (window as any).tagAcceptance = { opened: [] as string[], store: useStore };
    useStore.setState({ loadTree: async () => {}, openFile: async (path: string) => {
      if (++attempts === 1) throw new Error('fixture open failure');
      (window as any).tagAcceptance.opened.push(path);
    } });
    const host = document.createElement('div'); document.body.append(host);
    createRoot(host).render((React.default ?? React).createElement(Host));
    await openNativeTagPage('test');
  });
  await page.getByRole('button', { name: '创建并打开', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('fixture open failure');
  expect(await page.evaluate(() => (window as any).tagAcceptance.store.getState().toast)).toContain('索引尚未更新');
  await expect(page.getByLabel('标签页文件路径')).toBeDisabled();
  await page.getByRole('button', { name: '打开已创建文件', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '标签页', exact: true })).toHaveCount(0);
  expect(creates).toBe(1);
  expect(await page.evaluate(() => (window as any).tagAcceptance.opened)).toEqual(['Tag.md']);
});
