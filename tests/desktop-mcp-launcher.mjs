import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { _electron as electron, expect } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const executable = path.resolve(process.argv[2] ?? '');
assert(process.argv[2], 'Pass the packaged executable');
await fs.access(executable);
const resources = path.join(path.dirname(executable), 'resources');
const tunnel = path.join(resources, 'mcp-tunnel', process.platform === 'win32' ? 'tunnel-client.exe' : 'tunnel-client');
const tunnelVersion = execFileSync(tunnel, ['-v'], { encoding: 'utf8', windowsHide: true }).trim();
assert.match(tunnelVersion, /0\.0\.19/);
const parent = path.join(os.tmpdir(), '.agents');
await fs.mkdir(parent, { recursive: true });
const fixture = await fs.mkdtemp(path.join(parent, "mcp bundled ' fixture-"));
const profile = path.join(fixture, 'profile'), vault = path.join(fixture, 'vault');
await fs.mkdir(profile); await fs.mkdir(vault);
const original = '# MCP built-in acceptance\n\nDisposable document.\n';
await fs.writeFile(path.join(vault, 'fixture.md'), original);
const config = { vaultPath: vault, trustedPlugins: false, mcpProjectPath: path.join(fixture, 'missing-old-companion') };
await fs.writeFile(path.join(profile, 'desktop-config.json'), JSON.stringify(config));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const application = await electron.launch({ executablePath: executable, args: [`--user-data-dir=${profile}`], cwd: fixture, env, timeout: 120000 });
const errors = [], clients = [];
try {
  const page = await application.firstWindow();
  page.on('pageerror', error => errors.push(String(error)));
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 120000 });
  await page.getByRole('button', { name: 'MCP', exact: true }).click();
  const panel = page.getByLabel('MCP 连接', { exact: true });
  await expect(panel.getByRole('button', { name: '连接', exact: true })).toBeEnabled();
  await expect(panel.getByRole('button', { name: '选择项目', exact: true })).toHaveCount(0);
  assert.equal(await page.evaluate(() => window.webobsidianDesktop.mcp.selectProject), undefined);
  const state = await page.evaluate(() => window.webobsidianDesktop.mcp.inspect());
  assert.equal(state.available, true);
  const stdioConfig = JSON.parse(state.clientConfig).mcpServers.webobsidian;
  assert.equal(stdioConfig.command, executable);
  assert.deepEqual(stdioConfig.args, [path.join(resources, 'server', 'dist', 'mcp.cjs')]);
  const toolNames = ['obsidian_get_change_status', 'obsidian_get_context', 'obsidian_list_files', 'obsidian_propose_changes', 'obsidian_read_file', 'obsidian_search'];
  for (const transport of [
    new StreamableHTTPClientTransport(new URL('/mcp', page.url())),
    new StdioClientTransport({ ...stdioConfig, env: { ...process.env, ...stdioConfig.env, PATH: path.join(fixture, 'no-node-on-path') },
      cwd: fixture, stderr: 'pipe' }),
  ]) {
    const client = new Client({ name: 'bundled-acceptance', version: '1' }); clients.push(client);
    await client.connect(transport);
    assert.deepEqual((await client.listTools()).tools.map(tool => tool.name).sort(), toolNames);
    const result = await client.callTool({ name: 'obsidian_read_file', arguments: { path: 'fixture.md' } });
    assert(!result.isError, JSON.stringify(result));
    const read = JSON.parse(result.content[0].text);
    assert.equal(read.content, original);
    const proposalResult = await client.callTool({ name: 'obsidian_propose_changes', arguments: {
      request_id: `builtin-${clients.length}`, title: 'Built-in proposal acceptance',
      operations: [{ kind: 'edit', path: 'fixture.md', base_revision: read.revision,
        edits: [{ from: { line: 3, ch: 0 }, to: { line: 3, ch: 10 }, expected_text: 'Disposable', replacement: 'Reviewed' }] }],
    } });
    assert(!proposalResult.isError, JSON.stringify(proposalResult));
    assert.equal(JSON.parse(proposalResult.content[0].text).status, 'awaiting_user_review');
    assert.equal(await fs.readFile(path.join(vault, 'fixture.md'), 'utf8'), original);
  }
  await panel.getByRole('button', { name: '连接', exact: true }).click();
  await expect(panel.getByRole('status')).toHaveText('连接失败', { timeout: 10000 });
  await expect(panel.locator('pre')).toContainText('Tunnel ID');
  await expect(panel.getByLabel('Tunnel ID')).toBeVisible();
  await panel.getByLabel('Tunnel ID').fill('tunnel_fixture123');
  await panel.getByLabel('运行密钥').fill('fixture-not-a-real-key');
  await panel.getByRole('button', { name: '保存', exact: true }).click();
  await expect(panel.getByRole('status')).toHaveText('设置已保存');
  const stored = await fs.readFile(path.join(profile, 'mcp', 'connection.json'), 'utf8');
  assert(!stored.includes('fixture-not-a-real-key'));
  const restored = await application.evaluate(({ safeStorage }, serialized) =>
    safeStorage.decryptString(Buffer.from(JSON.parse(serialized).encryptedKey, 'base64')), stored);
  assert.equal(restored, 'fixture-not-a-real-key');
  await application.evaluate(({ clipboard }) => { globalThis.mcpAcceptanceClipboard = clipboard.readText(); });
  try {
    await panel.getByRole('button', { name: '复制配置', exact: true }).click();
    assert.equal(await application.evaluate(({ clipboard }) => clipboard.readText()), state.clientConfig);
  } finally {
    await application.evaluate(({ clipboard }) => { clipboard.writeText(globalThis.mcpAcceptanceClipboard); delete globalThis.mcpAcceptanceClipboard; });
  }
  assert.equal(await fs.readFile(path.join(vault, 'fixture.md'), 'utf8'), original);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(profile, 'desktop-config.json'), 'utf8')), config);
  assert.deepEqual(errors, []);
  const output = path.resolve(process.env.MCP_LAUNCHER_OUTPUT ?? fixture);
  await fs.mkdir(output, { recursive: true });
  await page.screenshot({ path: path.join(output, 'native-mcp-builtin.png') });
  const result = { executable, fixture, tunnelVersion, tools: toolNames, transports: ['HTTP', 'stdio without Node/PATH'],
    proposalWritesRequireReview: true, encryptedCredentialRoundtrip: true, errors, configUnchanged: true, vaultUnchanged: true,
    boundaries: 'Real packaged Electron/preload/IPC/HTTP/stdio and bundled Tunnel version; no real remote Tunnel key/registration or ChatGPT acceptance.' };
  await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await Promise.all(clients.map(client => client.close()));
  await application.close();
}
