import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { _electron as electron, expect } from '@playwright/test';

const profile = await fs.mkdtemp('/tmp/.agents/webobsidian-desktop-lifecycle-');
const vault = path.join(profile, 'vault');
await fs.mkdir(vault);
await fs.writeFile(path.join(vault, 'fixture.md'), '# native lifecycle\n');
await fs.writeFile(path.join(profile, 'desktop-config.json'), JSON.stringify({ vaultPath: vault }));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const application = await electron.launch({ executablePath: path.resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [path.resolve('desktop'), `--user-data-dir=${profile}`], env, timeout: 120000 });
try {
  await application.firstWindow();
  const initial = await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    const url = window.webContents.getURL();
    window.close();
    return url;
  });
  assert(initial.startsWith('data:'), 'Close the actual startup window before workspace load');
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(0);
  await application.evaluate(({ app }) => app.emit('activate'));
  const page = await application.firstWindow();
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 120000 });
  await expect(page.locator('.app')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.desktop-titlebar-fallback')).toBeHidden();
  assert.equal(await page.evaluate(() => window.webobsidianDesktop.version), '0.1.67');
  const endpoint = path.join(profile, 'server-data', 'operations-endpoint.json');
  const server = JSON.parse(await fs.readFile(endpoint, 'utf8'));
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), { timeout: 10000 }).toBe(0);
  assert.equal((await fetch(server.url + '/healthz')).status, 200);
  await application.evaluate(({ app }) => app.emit('activate'));
  const reopened = await application.firstWindow();
  await expect(reopened.locator('.app')).toBeVisible({ timeout: 30000 });
  await application.evaluate(({ dialog, BrowserWindow }) => {
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer();
  });
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), { timeout: 10000 }).toBe(0);
  const exited = application.waitForEvent('close');
  await application.evaluate(({ app }) => app.quit());
  await exited;
  await assert.rejects(fs.stat(endpoint), { code: 'ENOENT' });
  console.log('Native Electron splash close/activate, renderer save barrier, explicit crashed-renderer close, service lifetime and graceful quit passed');
} finally {
  await application.close().catch(() => {});
  await fs.rm(profile, { recursive: true, force: true });
}
