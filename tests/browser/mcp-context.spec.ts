import { test as base, expect } from './test';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const source = '\uFEFF# Context\r\n\r\nAlpha selected 😀 text.\r\n\r\nTail sentinel.\r\n';
const test = base.extend<{ backend: { url: string; vault: string } }>({
  backend: async ({}, use) => {
    const parent = path.join(os.tmpdir(), '.agents'); await fs.mkdir(parent, { recursive: true });
    const directory = await fs.mkdtemp(path.join(parent, 'mcp-context-browser-'));
    const vault = path.join(directory, 'vault'), data = path.join(directory, 'data');
    await fs.mkdir(vault); await fs.mkdir(data); await fs.writeFile(path.join(vault, 'context.md'), source);
    const child = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], { cwd: process.cwd(), windowsHide: true,
      env: { ...process.env, PORT: '0', HOST: '127.0.0.1', DATA_DIR: data, VAULT_PATH: vault, ALLOWED_ROOTS: directory,
        WEBOBSIDIAN_INITIAL_VAULT: '', NODE_ENV: 'development' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let logs = ''; child.stdout!.on('data', chunk => { logs += chunk; }); child.stderr!.on('data', chunk => { logs += chunk; });
    try {
      const endpoint = path.join(data, 'operations-endpoint.json');
      await expect.poll(async () => {
        if (child.exitCode !== null) throw new Error(logs);
        return fs.readFile(endpoint, 'utf8').then(text => JSON.parse(text).url, () => '');
      }, { timeout: 20000 }).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      await use({ url: JSON.parse(await fs.readFile(endpoint, 'utf8')).url, vault });
    } finally {
      if (child.exitCode === null) { const closed = new Promise(resolve => child.once('close', resolve)); child.kill(); await closed; }
      if (!path.resolve(directory).startsWith(path.join(parent, 'mcp-context-browser-'))) throw new Error('Invalid fixture path');
      await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  },
});

test.beforeEach(async ({ page, backend }) => {
  test.setTimeout(60000);
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    try {
      await route.fulfill({ response: await route.fetch({ url: backend.url + url.pathname + url.search }) });
    } catch {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
  });
  let clientReady = false;
  await page.routeWebSocket(url => url.searchParams.has('token'), socket => socket.send(JSON.stringify({ type: 'connected' })));
  await page.routeWebSocket('**/ws', socket => {
    const upstream = new WebSocket(backend.url.replace('http:', 'ws:') + '/ws');
    const pending: string[] = [];
    socket.onMessage(message => {
      const text = typeof message === 'string' ? message : message.toString('utf8');
      if (upstream.readyState === WebSocket.OPEN) upstream.send(text);
      else pending.push(text);
    });
    upstream.addEventListener('open', () => {
      for (const text of pending.splice(0)) upstream.send(text);
    });
    upstream.addEventListener('message', event => {
      const text = String(event.data);
      socket.send(text);
      try {
        if (JSON.parse(text).type === 'operations-client') clientReady = true;
      } catch {}
    });
    socket.onClose(() => upstream.close());
  });
  await page.route('**/note/context.md', async route => {
    if (route.request().resourceType() !== 'document') return route.fallback();
    const response = await route.fetch();
    const entry = '/@fs/' + path.resolve('tests/browser/appearanceFixture.tsx').replaceAll('\\', '/');
    await route.fulfill({ response, body: (await response.text()).replace('/src/main.tsx', entry) });
  });
  await page.goto('/note/context.md');
  await expect(page.locator('.main-pane .cm-content')).toContainText('Tail sentinel.');
  await expect.poll(() => clientReady).toBe(true);
  await page.getByRole('button', { name: 'MCP', exact: true }).click();
});

test('shortcut and context menu capture exact source coordinates, pinning and one-shot delivery', async ({ page, backend }) => {
  await page.locator('.main-pane .cm-content').click();
  await page.evaluate(async () => {
    const { getActiveEditor } = await import('/src/lib/activeEditor.ts');
    const view = getActiveEditor()!, from = view.state.doc.toString().indexOf('selected');
    view.dispatch({ selection: { anchor: from, head: from + 'selected 😀'.length } }); view.focus();
  });
  await page.keyboard.press('Control+Shift+M');
  await expect(page.locator('.mcp-context-item')).toHaveCount(1);
  const selected = await page.evaluate(async () => {
    const { request } = await import('/src/lib/api.ts'); return request('/api/operations/context');
  });
  expect(selected.items[0]).toMatchObject({ kind: 'selection', path: 'context.md', selections: [
    { kind: 'source', text: 'selected 😀', from: { line: 3, ch: 6 }, to: { line: 3, ch: 17 } },
  ] });
  await page.getByRole('button', { name: '固定保留' }).click();
  const read = () => page.evaluate(async () => {
    const { request } = await import('/src/lib/api.ts');
    return request('/api/operations/call', { method: 'POST', body: JSON.stringify({ name: 'obsidian_get_context', arguments: {} }) });
  });
  expect((await read()).queued_context[0].pinned).toBe(true);
  await expect(page.locator('.mcp-context-item')).toHaveCount(1);
  await page.getByRole('button', { name: '取消固定' }).click();
  expect((await read()).queued_context).toHaveLength(1);
  await expect(page.locator('.mcp-context-item')).toHaveCount(0);
  await page.locator('.main-pane .cm-content').click();
  await page.locator('.main-pane .cm-content').click({ button: 'right' });
  await page.getByText('添加当前页面到 MCP 上下文', { exact: true }).click();
  await expect(page.locator('.mcp-context-item')).toHaveCount(1);
  const queued = await read();
  expect(queued.queued_context[0].kind).toBe('page');
  expect(queued).not.toHaveProperty('nearby_text');
  expect(queued.queued_context[0]).not.toHaveProperty('selections');
  await expect(page.locator('.mcp-context-item')).toHaveCount(0);
  expect(await fs.readFile(path.join(backend.vault, 'context.md'), 'utf8')).toBe(source);
  await page.screenshot({ path: test.info().outputPath('mcp-panel.png') });
});

test('path-only context, manual removal, oversize selection rejection and reload persistence', async ({ page }) => {
  await page.locator('.main-pane .cm-content').click();
  await page.keyboard.press('Control+Shift+M');
  await expect(page.locator('.mcp-context-item')).toHaveCount(1);
  await page.getByRole('button', { name: '移除上下文' }).click();
  await expect(page.locator('.mcp-context-item')).toHaveCount(0);
  const result = await page.evaluate(async () => {
    const { captureMcpContextTarget, queueMcpContext, mcpContextSnapshot } = await import('/src/lib/review/client.ts');
    const target = captureMcpContextTarget();
    await queueMcpContext({ ...target, error: '选区过大' });
    return mcpContextSnapshot();
  });
  expect(result.items).toHaveLength(0); expect(result.error).toContain('选区过大');
  await page.getByRole('button', { name: '添加选中内容或当前页面' }).click();
  await expect(page.locator('.mcp-context-item')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.main-pane .cm-content')).toContainText('Tail sentinel.');
  await page.getByRole('button', { name: 'MCP', exact: true }).click();
  await expect(page.locator('.mcp-context-item')).toHaveCount(1);
});
