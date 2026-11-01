import { test as base, expect } from './test';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import type { AddressInfo } from 'node:net';

const source = '\uFEFF# Context\r\n\r\nAlpha selected 😀 text.\r\n\r\nAlpha selected 😀 text.\r\n\r\nTail sentinel.\r\n';
const test = base.extend<{ backend: { url: string; vault: string } }>({
  expectedErrors: async ({}, use) => { await use([]); },
  backend: async ({ page }, use) => {
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
      await page.close();
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
    } catch (error) {
      if (!page.isClosed() && route.request().failure()?.errorText !== 'net::ERR_ABORTED') throw error;
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

test('an open clean document refreshes native sync only after the workspace lease releases', async ({ page, backend }) => {
  const token = 'fixture-only-browser-sync-token-0123456789';
  const load = new Function('url', 'return import(url)') as (url: string) => Promise<typeof import('../../sync-server/server.mjs')>;
  const { createSyncServer } = await load(pathToFileURL(path.resolve('sync-server/server.mjs')).href);
  const hub = await createSyncServer({ root: path.join(path.dirname(backend.vault), 'sync-hub'), token });
  try {
    await new Promise<void>(resolve => hub.server.listen(0, '127.0.0.1', resolve));
    const endpoint = `http://127.0.0.1:${(hub.server.address() as AddressInfo).port}/webobsidian-sync/v1/`;
    const remote = async (resource: string, method = 'GET', body?: string) => {
      const response = await fetch(endpoint + resource, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body } : {}) });
      expect(response.ok).toBe(true); return response.json() as Promise<any>;
    };
    const manifest = await remote('manifest');
    const update = async (text: string, expectedVersion: number) => {
      const hash = createHash('sha256').update(text).digest('hex');
      await remote(`blobs/${hash}`, 'PUT', text);
      await remote('commit', 'POST', JSON.stringify({ workspaceId: manifest.workspaceId, deviceId: randomUUID(), operationId: randomUUID(),
        changes: [{ path: 'context.md', hash, expectedVersion }] }));
    };
    await update(source, 0);
    const identity = await (await page.request.get(backend.url + '/api/vault-identity')).json();
    const headers = { 'X-Vault-Identity': identity.vault };
    expect((await page.request.put(backend.url + '/api/file-sync', { headers, data: { enabled: true, endpoints: [endpoint], token, intervalSec: 3600 } })).ok()).toBe(true);
    await expect.poll(async () => (await (await page.request.post(backend.url + '/api/file-sync/run', { headers, data: {} })).json()).phase).toBe('idle');
    const changed = '\uFEFF# Context\r\n\r\nRemote synchronized text.\r\n\r\nTail sentinel.\r\n';
    await update(changed, 1);
    expect((await (await page.request.post(backend.url + '/api/file-sync/run', { headers, data: {} })).json()).phase).toBe('idle');
    expect(await fs.readFile(path.join(backend.vault, 'context.md'), 'utf8')).toBe(changed);
    await expect(page.locator('.main-pane .cm-content')).toContainText('Remote synchronized text.');
    await expect(page.locator('body')).not.toHaveAttribute('inert');
  } finally { await hub.close(); }
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
  await page.locator('.mcp-context-snippet').click();
  expect(await page.evaluate(async () => {
    const { getActiveEditor } = await import('/src/lib/activeEditor.ts');
    const view = getActiveEditor()!, range = view.state.selection.main;
    return { text: view.state.sliceDoc(range.from, range.to), line: view.state.doc.lineAt(range.from).number };
  })).toEqual({ text: 'selected 😀', line: 3 });
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

test('reading selection survives panel focus without fabricated source coordinates', async ({ page }) => {
  await page.locator('.main-pane .cm-content').click();
  await page.evaluate(async () => {
    const { setActiveEditorMode } = await import('/src/lib/activeEditor.ts');
    setActiveEditorMode('reading');
  });
  await expect.poll(() => page.evaluate(async () => {
    const { getActiveEditor } = await import('/src/lib/activeEditor.ts');
    return getActiveEditor()?.state.readOnly;
  })).toBe(true);
  await page.evaluate(() => {
    const content = document.querySelector('.main-pane .cm-content')!;
    const nodes = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = nodes.nextNode())) {
      const start = node.textContent!.indexOf('selected 😀');
      if (start < 0) continue;
      const range = document.createRange(); range.setStart(node, start); range.setEnd(node, start + 'selected 😀'.length);
      document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(range); return;
    }
    throw new Error('Reading text not found');
  });
  await expect.poll(() => page.evaluate(async () => {
    const { captureMcpContextTarget } = await import('/src/lib/review/client.ts');
    return captureMcpContextTarget().selections;
  })).toEqual([{ kind: 'rendered', text: 'selected 😀' }]);
  await page.getByRole('button', { name: '添加选中内容或当前页面' }).click();
  await expect(page.locator('.mcp-context-item')).toHaveCount(1);
  const queued = await page.evaluate(async () => {
    const { request } = await import('/src/lib/api.ts'); return request('/api/operations/context');
  });
  expect(queued.items[0].revision).toBeTruthy();
  expect(queued.items[0].selections).toEqual([{ kind: 'rendered', text: 'selected 😀' }]);
  await page.screenshot({ path: test.info().outputPath('mcp-reading-context.png') });
});

test('desktop manual controls do not auto-start, serialize actions and expose failures for retry', async ({ page }) => {
  await page.addInitScript(() => {
    const host = window as any;
    host.mcpCalls = [];
    const state = { available: true, tunnelId: 'tunnel_fixture123', hasKey: true, connected: false, clientConfig: '{}' };
    host.webobsidianDesktop = {
      platform: 'win32', nativePlugins: false, isDesktop: true,
      onBeforeClose: () => () => {}, openVaultPath: async () => {},
      webviewer: { subscribe: () => () => {} }, userscripts: { subscribe: () => () => {}, request: async () => [] },
      mcp: { inspect: async () => state, copyConfig: async () => {}, configure: async () => state,
        connect: () => {
          host.mcpCalls.push('Connect');
          return new Promise(resolve => { host.finishMcp = (ok: boolean) => resolve({ ...state, ok, output: ok ? 'fixture ready' : 'fixture offline' }); });
        } },
    };
  });
  await page.reload();
  await page.getByRole('button', { name: 'MCP', exact: true }).click();
  const launcher = page.getByLabel('MCP 连接', { exact: true });
  await expect(launcher.getByRole('button', { name: '连接', exact: true })).toBeEnabled();
  await expect(launcher.getByRole('button', { name: /启动 MCP|重新连接|检查状态/ })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).mcpCalls)).toEqual([]);
  await launcher.getByRole('button', { name: '连接', exact: true }).click();
  await expect(launcher.getByRole('button', { name: '连接', exact: true })).toBeDisabled();
  await expect(launcher.getByRole('button', { name: '选择项目', exact: true })).toHaveCount(0);
  await expect(launcher.getByRole('button', { name: '连接设置', exact: true })).toBeDisabled();
  await page.evaluate(() => (window as any).finishMcp(true));
  await expect(launcher.getByRole('status')).toHaveText('连接完成');
  await launcher.getByRole('button', { name: '连接', exact: true }).click();
  await page.evaluate(() => (window as any).finishMcp(false));
  await expect(launcher.locator('details')).toHaveAttribute('open', '');
  await expect(launcher.locator('pre')).toHaveText('fixture offline');
  await launcher.getByRole('button', { name: '连接', exact: true }).click();
  await page.evaluate(() => (window as any).finishMcp(true));
  await expect(launcher.getByRole('status')).toHaveText('连接完成');
  expect(await page.evaluate(() => (window as any).mcpCalls)).toEqual(['Connect', 'Connect', 'Connect']);
  await page.screenshot({ path: test.info().outputPath('mcp-native-controls.png') });
});

test('built-in MCP works without a project directory and stores only explicit connection settings', async ({ page }) => {
  await page.addInitScript(() => {
    const host = window as any;
    const state = { available: true, tunnelId: '', hasKey: false, connected: false, clientConfig: '{}' };
    host.savedMcp = null; host.copiedMcp = false;
    host.webobsidianDesktop = { platform: 'darwin',
      onBeforeClose: () => () => {}, webviewer: { subscribe: () => () => {} }, userscripts: { subscribe: () => () => {}, request: async () => [] },
      mcp: { inspect: async () => state,
        configure: async (input: unknown) => { host.savedMcp = input; return { ...state, tunnelId: 'tunnel_fixture123', hasKey: true }; },
        copyConfig: async () => { host.copiedMcp = true; },
        connect: async () => { throw new Error('fixture failed to launch'); } } };
  });
  await page.reload();
  await page.getByRole('button', { name: 'MCP', exact: true }).click();
  const launcher = page.getByLabel('MCP 连接', { exact: true });
  await expect(launcher.getByRole('button', { name: '连接', exact: true })).toBeEnabled();
  await expect(launcher.getByRole('button', { name: '选择项目', exact: true })).toHaveCount(0);
  await expect(launcher).not.toContainText('项目目录');
  await launcher.getByRole('button', { name: '连接设置', exact: true }).click();
  await launcher.getByLabel('Tunnel ID').fill('tunnel_fixture123');
  await launcher.getByLabel('运行密钥').fill('fixture-secret');
  await launcher.getByRole('button', { name: '保存', exact: true }).click();
  expect(await page.evaluate(() => (window as any).savedMcp)).toEqual({ tunnelId: 'tunnel_fixture123', apiKey: 'fixture-secret' });
  await launcher.getByRole('button', { name: '复制配置', exact: true }).click();
  expect(await page.evaluate(() => (window as any).copiedMcp)).toBe(true);
  await launcher.getByRole('button', { name: '连接', exact: true }).click();
  await expect(launcher.getByRole('alert')).toContainText('fixture failed to launch');
  await expect(launcher.getByRole('button', { name: '连接', exact: true })).toBeEnabled();
});

async function noteTool(url: string, name: string, args: object) {
  const response = await fetch(url + '/mcp', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
  const payload = await response.json() as any;
  if (payload.error || payload.result?.isError) throw new Error(JSON.stringify(payload));
  return payload.result.structuredContent;
}

test('MCP creates a reviewed note with exact bytes, skips templates, then renames the live session', async ({ page, backend }) => {
  const content = '\ufeff# MCP note\r\n\r\n中文 😀\r\n<script>window.unreviewedExecution = true</script>\n';
  await page.evaluate(async () => {
    const { sharedApp } = await import('/src/lib/plugins.ts');
    sharedApp.vault.prepareNewNote = async () => { throw new Error('Unreviewed template must not run'); };
  });
  const proposed = await noteTool(backend.url, 'obsidian_propose_changes', { request_id: 'create-reviewed', title: '新建测试笔记',
    operations: [{ kind: 'create', path: 'MCP/新笔记.md', content }] });
  expect(proposed.status).toBe('awaiting_user_review');
  await expect(fs.readFile(path.join(backend.vault, 'MCP/新笔记.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  await page.getByRole('button', { name: '待审阅修改 1', exact: true }).click();
  await page.getByRole('button', { name: /新建测试笔记.*MCP\/新笔记/ }).click();
  const dialog = page.getByRole('dialog', { name: '笔记操作审阅' });
  await expect(dialog.locator('pre')).toContainText('中文 😀');
  expect(await page.evaluate(() => (window as any).unreviewedExecution)).toBeUndefined();
  await page.screenshot({ path: test.info().outputPath('mcp-create-review.png') });
  await dialog.getByRole('button', { name: '接受', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('已接受');
  expect(await fs.readFile(path.join(backend.vault, 'MCP/新笔记.md'), 'utf8')).toBe(content);
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  const current = await noteTool(backend.url, 'obsidian_read_file', { path: 'MCP/新笔记.md' });
  const renamed = await noteTool(backend.url, 'obsidian_propose_changes', { request_id: 'rename-reviewed', title: '重命名测试笔记',
    operations: [{ kind: 'rename', path: 'MCP/新笔记.md', to: 'MCP/重命名.md', base_revision: current.revision }] });
  expect(await fs.readFile(path.join(backend.vault, 'MCP/新笔记.md'), 'utf8')).toBe(content);
  await page.getByRole('button', { name: '待审阅修改 1', exact: true }).click();
  // The inbox keeps its selected file proposal until the user returns to the list.
  await dialog.getByRole('button', { name: '返回列表', exact: true }).click();
  await page.getByRole('button', { name: /重命名测试笔记.*MCP\/新笔记/ }).click();
  await expect(dialog).toContainText('MCP/新笔记.md → MCP/重命名.md');
  await page.screenshot({ path: test.info().outputPath('mcp-rename-review.png') });
  await dialog.getByRole('button', { name: '接受', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('已接受');
  expect(await fs.readFile(path.join(backend.vault, 'MCP/重命名.md'), 'utf8')).toBe(content);
  await expect(fs.readFile(path.join(backend.vault, 'MCP/新笔记.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await noteTool(backend.url, 'obsidian_get_change_status', { proposal_id: renamed.proposal_id })).toMatchObject({
    operation: { kind: 'rename', status: 'accepted' }, applied_steps: 1 });
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  expect(await page.evaluate(async () => {
    const { useStore } = await import('/src/lib/store.ts');
    const { documents } = await import('/src/lib/documents.ts');
    return { active: useStore.getState().activePath, old: !!documents.get('MCP/新笔记.md'), next: !!documents.get('MCP/重命名.md') };
  })).toEqual({ active: 'MCP/重命名.md', old: false, next: true });
});

test('MCP file review rejects safely and reports a target created after proposal', async ({ page, backend, expectedErrors }) => {
  const proposed = await noteTool(backend.url, 'obsidian_propose_changes', { request_id: 'reject-created', title: '拒绝新建',
    operations: [{ kind: 'create', path: 'rejected.md', content: 'Never written' }] });
  await page.getByRole('button', { name: '待审阅修改 1', exact: true }).click();
  await page.getByRole('button', { name: /拒绝新建.*rejected.md/ }).click();
  const dialog = page.getByRole('dialog', { name: '笔记操作审阅' });
  await dialog.getByRole('button', { name: '拒绝', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('已拒绝');
  await expect(fs.readFile(path.join(backend.vault, 'rejected.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await noteTool(backend.url, 'obsidian_get_change_status', { proposal_id: proposed.proposal_id })).toMatchObject({ operation: { status: 'rejected' } });
  await dialog.getByRole('button', { name: '返回列表', exact: true }).click();
  await page.getByRole('dialog', { name: '候选修改', exact: true }).getByRole('button', { name: '关闭', exact: true }).click();
  await noteTool(backend.url, 'obsidian_propose_changes', { request_id: 'collision-created', title: '冲突新建',
    operations: [{ kind: 'create', path: 'collision.md', content: 'Must not overwrite' }] });
  await fs.writeFile(path.join(backend.vault, 'collision.md'), 'Existing file');
  await page.getByRole('button', { name: '待审阅修改 1', exact: true }).click();
  await page.getByRole('button', { name: /冲突新建.*collision.md/ }).click();
  expectedErrors.push('409');
  await dialog.getByRole('button', { name: '接受', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('目标路径已存在');
  expect(await fs.readFile(path.join(backend.vault, 'collision.md'), 'utf8')).toBe('Existing file');
});

test('MCP rename refuses changed source at local acceptance', async ({ page, backend, expectedErrors }) => {
  const current = await noteTool(backend.url, 'obsidian_read_file', { path: 'context.md' });
  await noteTool(backend.url, 'obsidian_propose_changes', { request_id: 'stale-rename', title: '过期重命名',
    operations: [{ kind: 'rename', path: 'context.md', to: 'renamed.md', base_revision: current.revision }] });
  await fs.writeFile(path.join(backend.vault, 'context.md'), source + '\nExternal edit\n');
  await page.getByRole('button', { name: '待审阅修改 1', exact: true }).click();
  await page.getByRole('button', { name: /过期重命名.*context.md/ }).click();
  const dialog = page.getByRole('dialog', { name: '笔记操作审阅' });
  expectedErrors.push('409');
  await dialog.getByRole('button', { name: '接受', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('源笔记已改变');
  expect(await fs.readFile(path.join(backend.vault, 'context.md'), 'utf8')).toBe(source + '\nExternal edit\n');
  await expect(fs.readFile(path.join(backend.vault, 'renamed.md'))).rejects.toMatchObject({ code: 'ENOENT' });
});
