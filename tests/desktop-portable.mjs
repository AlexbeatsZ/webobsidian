// Exercise the actual NSIS portable launcher twice: unpacked/server tests miss
// launcher cleanup deleting a still-running first instance's web resources.
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { chromium } from '@playwright/test';

assert.equal(process.platform, 'win32', 'This acceptance run requires Windows');
const executable = path.resolve(process.argv[2] ?? '');
assert(process.argv[2]?.endsWith('.exe'), 'Pass the generated Windows portable EXE');
await fs.access(executable);
const fixture = await fs.mkdtemp(path.join(os.tmpdir(), '.agents/webobsidian-portable-'));
const profile = path.join(fixture, 'profile'), vault = path.join(fixture, 'vault');
await fs.mkdir(profile); await fs.mkdir(vault);
await fs.writeFile(path.join(vault, 'portable-acceptance.md'), '# Portable acceptance\n\nDisposable note.\n');
await fs.writeFile(path.join(profile, 'desktop-config.json'), JSON.stringify({ vaultPath: vault, secret: 'disposable-portable-acceptance-secret' }));
const socket = createServer();
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
const debugPort = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const launch = () => spawn(executable, [`--user-data-dir=${profile}`, `--remote-debugging-port=${debugPort}`], {
  env, cwd: fixture, windowsHide: true, stdio: 'ignore',
});
const launchers = [launch()];
let browser, page, base, extractedIndex;
const waitUntil = async (check, message, timeout = 30000) => {
  const deadline = Date.now() + timeout;
  while (!await check()) {
    if (Date.now() > deadline) throw Error(message);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
};
const errors = [];
try {
  await waitUntil(() => fetch(`http://127.0.0.1:${debugPort}/json/version`).then(r => r.ok).catch(() => false), 'Desktop debugger did not start');
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  const context = browser.contexts()[0];
  await waitUntil(() => context.pages().some(p => p.url() !== 'about:blank'), 'No native BrowserWindow');
  page = context.pages()[0];
  const sawLoading = page.url().startsWith('data:') && (await page.locator('[role=status]').innerText()) === '正在打开笔记库';
  for (const p of context.pages()) p.on('pageerror', error => errors.push(error.stack));
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 120000 });
  base = new URL(page.url()).origin;
  await page.locator('.workspace-launcher, .workspace-tabs').first().waitFor({ timeout: 30000 });
  const log = await fs.readFile(path.join(profile, 'logs/server.log'), 'utf8');
  assert(log.includes(`Vault: ${vault}`), 'The desktop must use only the disposable Vault');
  // Locate the resources through the launched Electron process's command line,
  // without importing anything from or changing the user's application profile.
  const { execFileSync } = await import('node:child_process');
  const processJson = execFileSync('powershell.exe', ['-NoProfile', '-Command',
    `Get-CimInstance Win32_Process -Filter 'ParentProcessId=${launchers[0].pid}' | Select-Object -ExpandProperty ExecutablePath | ConvertTo-Json`], { encoding: 'utf8', windowsHide: true });
  const children = JSON.parse(processJson);
  const appExe = (Array.isArray(children) ? children : [children]).find(p => p?.endsWith('WebObsidian.exe'));
  assert(appExe, 'The portable must launch its extracted Electron executable');
  extractedIndex = path.join(path.dirname(appExe), 'resources/server/public/index.html');
  await fs.access(extractedIndex);
  await page.keyboard.press('Control+o');
  await page.locator('.palette-input').fill('portable-acceptance');
  await page.keyboard.press('Enter');
  await page.locator('.cm-content').first().waitFor();
  await page.locator('.cm-content').first().click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' Saved in native Electron.');
  await page.keyboard.press('Control+s');
  await waitUntil(async () => (await fs.readFile(path.join(vault, 'portable-acceptance.md'), 'utf8')).includes('Saved in native Electron.'), 'Native note did not save');
  // Click again while the first instance is alive; the losing single-instance
  // child and its launcher must exit without removing the first one's files.
  const second = launch(); launchers.push(second);
  await Promise.race([once(second, 'exit'), new Promise((_, reject) => { const timer = setTimeout(() => reject(Error('Second launcher did not exit')), 30000); timer.unref(); })]);
  await fs.access(extractedIndex);
  assert.equal((await fetch(base + '/')).status, 200, 'First instance must still serve the SPA');
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.cm-content').first().waitFor();
  assert((await page.locator('.cm-content').first().innerText()).includes('Saved in native Electron.'));
  assert.deepEqual(errors, [], 'Native production renderer must have no uncaught errors');
  console.log(JSON.stringify({ passed: true, sawLoading, nativeSave: true, secondLaunchPreservesResources: true, reload: true, vault, extractedIndex }, null, 2));
} finally {
  if (page && !page.isClosed()) await page.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  for (const launcher of launchers) {
    if (launcher.exitCode === null) {
      await Promise.race([once(launcher, 'exit'), new Promise(resolve => setTimeout(resolve, 5000))]);
      if (launcher.exitCode === null) {
        const { execFileSync } = await import('node:child_process');
        execFileSync('taskkill.exe', ['/PID', String(launcher.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      }
    }
  }
  await fs.rm(fixture, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
