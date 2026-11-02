import { test, expect } from './test';

// Disposable in-memory tree; deletion is intercepted before any API call.
test('a file-tree multi-selection shows its batch actions above the list', async ({ page }) => {
  await page.goto('/__render-test');
  await page.waitForFunction(() => Boolean(window.renderHarness));
  await page.evaluate(async () => {
    const React = await import('/node_modules/.vite/deps/react.js');
    const ReactDOM = await import('/node_modules/.vite/deps/react-dom_client.js');
    const createRoot = ReactDOM.createRoot ?? ReactDOM.default.createRoot;
    const { default: FileTree } = await import('/src/components/FileTree.tsx');
    const { useStore } = await import('/src/lib/store.ts');
    const file = (path: string) => ({ name: path, path, type: 'file', extension: 'md', mtime: 1, ctime: 1, size: 1 });
    const removed: string[] = [];
    (window as any).fileSelection = { removed, moved: () => useStore.getState().movePath };
    useStore.setState({ tree: { name: 'Fixture', path: '', type: 'folder', children: ['a.md', 'b.md', 'c.md'].map(file) } as any,
      filePaths: ['a.md', 'b.md', 'c.md'], selected: [], openFile: async () => {}, removePath: async (path: string) => { removed.push(path); return { deleted: false }; } });
    document.getElementById('root')!.hidden = true;
    const host = document.createElement('div'); host.className = 'app theme-dark'; host.style.cssText = 'width:300px'; document.body.append(host);
    createRoot(host).render((React.default ?? React).createElement(FileTree));
  });
  const bar = page.getByRole('toolbar', { name: '所选文件操作' });
  await page.getByTitle('a.md', { exact: true }).click();
  await expect(bar).toHaveCount(0);
  await page.getByTitle('c.md', { exact: true }).click({ modifiers: ['Shift'] });
  await expect(bar).toContainText('已选 3');
  await page.screenshot({ path: test.info().outputPath('file-selection.png') });
  await bar.getByRole('button', { name: '移动' }).click();
  expect(await page.evaluate(() => (window as any).fileSelection.moved())).toEqual(['a.md', 'b.md', 'c.md']);
  page.once('dialog', dialog => { expect(dialog.message()).toBe('删除 3 项？'); void dialog.accept(); });
  await bar.getByRole('button', { name: '删除' }).click();
  await expect(bar).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).fileSelection.removed)).toEqual(['a.md', 'b.md', 'c.md']);
});
