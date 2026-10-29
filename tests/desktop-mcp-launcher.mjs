import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { _electron as electron, expect } from '@playwright/test';

assert.equal(process.platform, 'win32');
const executable = path.resolve(process.argv[2] ?? '');
assert(process.argv[2]?.endsWith('.exe'), 'Pass the packaged Windows executable');
await fs.access(executable);
const parent = path.join(os.tmpdir(), '.agents');
await fs.mkdir(parent, { recursive: true });
const fixture = await fs.mkdtemp(path.join(parent, "mcp native ' fixture-"));
const profile = path.join(fixture, 'profile'), vault = path.join(fixture, 'vault'), project = path.join(fixture, 'mcp');
await fs.mkdir(profile); await fs.mkdir(vault); await fs.mkdir(path.join(project, 'scripts'), { recursive: true });
await fs.writeFile(path.join(vault, 'fixture.md'), '# MCP launcher acceptance\n\nDisposable document.\n');
const config = { vaultPath: vault, mcpProjectPath: project, trustedPlugins: false };
await fs.writeFile(path.join(profile, 'desktop-config.json'), JSON.stringify(config));
await fs.writeFile(path.join(project, 'package.json'), '{"name":"obsidian-context-mcp"}');
await fs.writeFile(path.join(project, 'scripts', 'manual-start-mcp.ps1'), `param([string]$Action, [string]$EndpointFile)
$ErrorActionPreference = 'Stop'
Write-Host 'fixture host output'
Write-Progress -Activity 'fixture progress' -Status 'running'
$endpoint = Get-Content -LiteralPath $EndpointFile -Raw | ConvertFrom-Json
$health = Invoke-RestMethod -Uri ($endpoint.url + '/healthz') -TimeoutSec 3
if (-not $health.ok) { throw 'Fixture health failed' }
[IO.File]::AppendAllText((Join-Path (Split-Path -Parent $PSScriptRoot) 'actions.log'), ($Action + [Environment]::NewLine))
Start-Sleep -Milliseconds 500
if (@(Get-Content -LiteralPath (Join-Path (Split-Path -Parent $PSScriptRoot) 'actions.log')).Count -eq 2) { Write-Output 'fixture offline'; exit 1 }
Write-Output ('fixture ready: ' + $Action)
exit 0
`, 'utf8');
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const application = await electron.launch({ executablePath: executable, args: [`--user-data-dir=${profile}`], cwd: fixture, env, timeout: 120000 });
const errors = [];
try {
  const page = await application.firstWindow();
  page.on('pageerror', error => errors.push(String(error)));
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 120000 });
  await page.getByRole('button', { name: 'MCP', exact: true }).click();
  const panel = page.getByLabel('MCP 连接', { exact: true });
  await expect(panel.getByRole('button', { name: '连接', exact: true })).toBeEnabled();
  await expect(panel.getByRole('button', { name: /启动 MCP|重新连接|检查状态/ })).toHaveCount(0);
  assert.equal(await fs.readFile(path.join(project, 'actions.log'), 'utf8').catch(() => ''), '');
  assert.equal(await page.evaluate(() => window.webobsidianDesktop.mcp.run), undefined);
  await panel.getByRole('button', { name: '连接', exact: true }).click();
  await expect(panel.getByRole('button', { name: '连接', exact: true })).toBeDisabled();
  await expect(panel.getByRole('status')).toHaveText('连接完成', { timeout: 15000 });
  await panel.getByRole('button', { name: '连接', exact: true }).click();
  await expect(panel.getByRole('status')).toHaveText('连接失败', { timeout: 15000 });
  await expect(panel.locator('pre')).toContainText('fixture offline');
  await panel.getByRole('button', { name: '连接', exact: true }).click();
  await expect(panel.getByRole('status')).toHaveText('连接完成', { timeout: 15000 });
  await expect(panel.locator('pre')).toHaveText('fixture host output\nfixture ready: Connect');
  await expect(panel.locator('pre')).not.toContainText('CLIXML');
  assert.deepEqual((await fs.readFile(path.join(project, 'actions.log'), 'utf8')).trim().split(/\r?\n/), ['Connect', 'Connect', 'Connect']);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(profile, 'desktop-config.json'), 'utf8')), config);
  assert.equal(await fs.readFile(path.join(vault, 'fixture.md'), 'utf8'), '# MCP launcher acceptance\n\nDisposable document.\n');
  assert.deepEqual(errors, []);
  const output = path.resolve(process.env.MCP_LAUNCHER_OUTPUT ?? fixture);
  await fs.mkdir(output, { recursive: true });
  await panel.locator('summary').click();
  await page.screenshot({ path: path.join(output, 'native-mcp-launcher.png') });
  const result = { executable, fixture, actions: ['Connect', 'Connect', 'Connect'], errors, configUnchanged: true, vaultUnchanged: true,
    boundaries: 'Real packaged Electron/preload/IPC/PowerShell against a disposable manual-script fixture; no live Tunnel action or remote ChatGPT acceptance.' };
  await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await application.close(); }
