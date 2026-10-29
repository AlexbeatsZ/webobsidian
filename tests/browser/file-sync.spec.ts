import { test, expect } from './test';

test.beforeEach(async ({ page }) => {
  const connection = {
    preferences: { enabled: false, endpoints: ['http://192.168.1.10:18744/webobsidian-sync/v1/', 'https://example.com/webobsidian-sync/v1/'], token: '••••••••', intervalSec: 15 },
    status: { enabled: false, endpoints: [], hasToken: true, activeEndpoint: null as string | null, phase: 'disabled', message: '', lastSuccess: null,
      conflictDirectory: null as string | null, conflictBranches: [] as string[] },
  };
  const requests: { path: string; body: any }[] = [];
  await page.route('**/api/file-sync**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (request.method() !== 'GET') {
      const body = request.postDataJSON(); requests.push({ path, body });
      if (request.method() === 'PUT') {
        Object.assign(connection.preferences, body); connection.status.enabled = body.enabled; connection.status.phase = body.enabled ? 'idle' : 'disabled';
      } else if (path.endsWith('/run')) {
        connection.status.phase = 'conflict'; connection.status.message = '发现 1 个冲突，已保留本机与远端两版';
        connection.status.activeEndpoint = connection.preferences.endpoints[1]; connection.status.conflictDirectory = 'C:/fixture/recovery/local-remote';
        connection.status.conflictBranches = ['webobsidian-conflicts/fixture/local', 'webobsidian-conflicts/fixture/remote'];
      } else { connection.status.phase = 'idle'; connection.status.message = '同步完成'; connection.status.conflictDirectory = null; }
    }
    await route.fulfill({ json: connection });
  });
  await page.exposeFunction('fileSyncRequests', () => requests);
  await page.goto('/__render-test'); await page.waitForFunction(() => Boolean(window.renderHarness));
  await page.evaluate(async () => {
    const load = (module: string) => import(module);
    const [React, ReactDOM, { default: FileSyncSettings }] = await Promise.all([
      load('/node_modules/.vite/deps/react.js'), load('/node_modules/.vite/deps/react-dom_client.js'), load('/src/components/FileSyncSettings.tsx'),
    ]);
    document.getElementById('root')!.hidden = true;
    const host = document.createElement('div'); host.style.cssText = 'position:fixed;inset:12px;display:flex;justify-content:center'; document.body.append(host);
    const element = (React.default ?? React).createElement;
    (ReactDOM.createRoot ?? ReactDOM.default.createRoot)(host).render(element('div', { className: 'settings-modal' }, element('div', { className: 'settings-content' }, element(FileSyncSettings))));
  });
  await expect(page.getByRole('heading', { name: '文件同步', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '同步地址', exact: true })).toHaveValue(connection.preferences.endpoints.join('\n'));
});

test('keeps address order, retains the masked token and does not synchronize just by opening settings', async ({ page }) => {
  expect(await page.evaluate(() => (window as any).fileSyncRequests())).toEqual([]);
  await expect(page.getByText('随 Vault 保存；请使用私有仓库', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '同步地址', exact: true }).fill('100.106.169.46:18744\n192.168.1.10:18744\nhttps://example.com/webobsidian-sync/v1/');
  await page.getByRole('checkbox', { name: '启用文件同步' }).check(); await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('就绪');
  const requests = await page.evaluate(() => (window as any).fileSyncRequests());
  expect(requests).toHaveLength(1); expect(requests[0].body.endpoints).toEqual(['100.106.169.46:18744', '192.168.1.10:18744', 'https://example.com/webobsidian-sync/v1/']);
  expect(requests[0].body.token).toBe('••••••••');
  await page.screenshot({ path: test.info().outputPath('file-sync-addresses.png') });
});

test('shows retained conflict versions and sends an explicit resolution without Git transport', async ({ page }) => {
  await page.getByRole('checkbox', { name: '启用文件同步' }).check(); await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '立即同步', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已保留本机与远端两版');
  await expect(page.getByText('C:/fixture/recovery/local-remote', { exact: true })).toBeVisible();
  await expect(page.getByText('https://example.com/webobsidian-sync/v1/', { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('file-sync-conflict.png') });
  await page.getByRole('button', { name: '采用远端版本' }).click(); await expect(page.getByRole('status')).toContainText('同步完成');
  const requests = await page.evaluate(() => (window as any).fileSyncRequests());
  expect(requests.map((request: any) => request.path)).toEqual(['/api/file-sync', '/api/file-sync/run', '/api/file-sync/resolve']);
  expect(requests[2].body).toEqual({ choice: 'remote' });
});
