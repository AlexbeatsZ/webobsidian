import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { _electron as electron, expect } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

assert(process.argv[2], 'Pass the packaged WebObsidian executable');
const executable = path.resolve(process.argv[2]);
const parent = path.join(os.tmpdir(), '.agents');
await fs.mkdir(parent, { recursive: true });
const fixture = await fs.mkdtemp(path.join(parent, 'mcp-note-package-'));
const profile = path.join(fixture, 'profile'), vault = path.join(fixture, 'vault');
await fs.mkdir(profile); await fs.mkdir(vault);
await fs.writeFile(path.join(profile, 'desktop-config.json'), JSON.stringify({ vaultPath: vault, trustedPlugins: false }));
await fs.writeFile(path.join(vault, 'fixture.md'), '# Fixture\n\nOriginal note.\n');
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: executable, args: [`--user-data-dir=${profile}`], cwd: fixture, env, timeout: 120000 });
const clients = [], errors = [];
const output = path.resolve(process.env.MCP_NOTES_OUTPUT ?? fixture);
let stderr = '';
app.process().stderr?.on('data', chunk => { stderr = (stderr + chunk).slice(-6000); });
try {
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(String(error)));
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 120000 });
  await expect(page.getByRole('button', { name: 'MCP', exact: true })).toBeVisible({ timeout: 30000 });
  const settings = await page.evaluate(async () => (await fetch('/api/settings')).json());
  assert.equal(path.resolve(settings.vault.path), path.resolve(vault));
  const host = await page.evaluate(() => window.webobsidianDesktop.mcp.inspect());
  const stdio = JSON.parse(host.clientConfig).mcpServers.webobsidian;
  for (const transport of [new StreamableHTTPClientTransport(new URL('/mcp', page.url())),
    new StdioClientTransport({ ...stdio, env: { ...process.env, ...stdio.env, PATH: path.join(fixture, 'no-node-on-path') }, cwd: fixture, stderr: 'pipe' })]) {
    const client = new Client({ name: 'note-package-acceptance', version: '1' });
    clients.push(client); await client.connect(transport);
    assert.equal((await client.listTools()).tools.length, 6);
  }
  const call = async (client, name, args) => {
    const result = await client.callTool({ name, arguments: args });
    assert(!result.isError, JSON.stringify(result));
    return result.structuredContent ?? JSON.parse(result.content[0].text);
  };
  const select = async title => {
    await page.getByRole('button', { name: '待审阅修改 1', exact: true }).click();
    const previous = page.getByRole('dialog', { name: '笔记操作审阅' });
    if (await previous.isVisible()) await previous.getByRole('button', { name: '返回列表', exact: true }).click();
    await page.getByRole('button', { name: new RegExp(title) }).click();
    return page.getByRole('dialog', { name: '笔记操作审阅' });
  };
  const content = '\ufeff# Packaged MCP\r\n\r\n中文 😀\nTail\r';
  const created = await call(clients[0], 'obsidian_propose_changes', { request_id: 'package-create', title: 'Package create',
    operations: [{ kind: 'create', path: 'MCP/new.md', content }] });
  assert.equal(created.status, 'awaiting_user_review');
  await assert.rejects(fs.readFile(path.join(vault, 'MCP/new.md')), { code: 'ENOENT' });
  let dialog = await select('Package create');
  await expect(dialog.locator('pre')).toContainText('中文 😀');
  await dialog.getByRole('button', { name: '接受', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('已接受');
  assert.equal(await fs.readFile(path.join(vault, 'MCP/new.md'), 'utf8'), content);
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  const read = await call(clients[1], 'obsidian_read_file', { path: 'MCP/new.md' });
  const renamed = await call(clients[1], 'obsidian_propose_changes', { request_id: 'package-rename', title: 'Package rename',
    operations: [{ kind: 'rename', path: 'MCP/new.md', to: 'MCP/renamed.md', base_revision: read.revision }] });
  assert.equal(renamed.status, 'awaiting_user_review');
  assert.equal(await fs.readFile(path.join(vault, 'MCP/new.md'), 'utf8'), content);
  dialog = await select('Package rename');
  await expect(dialog).toContainText('MCP/new.md → MCP/renamed.md');
  await dialog.getByRole('button', { name: '接受', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('已接受');
  assert.equal(await fs.readFile(path.join(vault, 'MCP/renamed.md'), 'utf8'), content);
  await assert.rejects(fs.readFile(path.join(vault, 'MCP/new.md')), { code: 'ENOENT' });
  assert.equal((await call(clients[0], 'obsidian_get_change_status', { proposal_id: renamed.proposal_id })).operation.status, 'accepted');
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  const rejected = await call(clients[0], 'obsidian_propose_changes', { request_id: 'package-reject', title: 'Package reject',
    operations: [{ kind: 'create', path: 'rejected.md', content: '' }] });
  dialog = await select('Package reject');
  await dialog.getByRole('button', { name: '拒绝', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('已拒绝');
  await assert.rejects(fs.readFile(path.join(vault, 'rejected.md')), { code: 'ENOENT' });
  assert.equal((await call(clients[1], 'obsidian_get_change_status', { proposal_id: rejected.proposal_id })).operation.status, 'rejected');
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  for (const route of ['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-authorization-server']) {
    const response = await fetch(new URL(route, page.url()));
    assert.equal(response.status, 404);
    assert.match(response.headers.get('content-type'), /application\/json/);
  }
  assert.equal(await fs.readFile(path.join(vault, 'fixture.md'), 'utf8'), '# Fixture\n\nOriginal note.\n');
  assert.deepEqual(errors, []);
  await fs.mkdir(output, { recursive: true });
  await page.screenshot({ path: path.join(output, 'packaged-mcp-notes.png') });
  const result = { executable, fixture, transports: ['HTTP', 'stdio without Node on PATH'],
    proposalsNoWrite: true, createExactBytes: true, renameExactBytes: true, rejectionNoWrite: true,
    oauthJson404: true, rendererErrors: errors,
    boundary: 'Actual packaged isolated Electron app and MCP; no cloud Tunnel authentication or remote ChatGPT acceptance.' };
  await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, 'failure.json'), JSON.stringify({
    fixture, error: String(error), exitCode: app.process().exitCode, signal: app.process().signalCode, stderr,
  }, null, 2));
  throw error;
} finally {
  await Promise.all(clients.map(client => client.close()));
  await app.close();
}
