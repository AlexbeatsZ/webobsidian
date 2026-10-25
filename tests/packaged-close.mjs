import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { Script } from 'node:vm';
import { _electron, expect } from '@playwright/test';

const desktop = path.resolve(process.argv[2] ?? 'desktop');
const entry = path.join(desktop, 'dist/main.js');
const tempRoot = await fs.realpath(path.join(os.tmpdir(), '.agents'));
const physicalDesktop = await fs.realpath(desktop);
assert(physicalDesktop.toLowerCase().startsWith(tempRoot.toLowerCase() + path.sep), 'Use a physical isolated Temp/.agents desktop build');
await fs.access(entry);
await fs.access(path.join(desktop, '.gen/server/dist/index.mjs'));
const output = process.env.PACKAGED_CLOSE_OUTPUT ? path.resolve(process.env.PACKAGED_CLOSE_OUTPUT)
  : await fs.mkdtemp(path.join(tempRoot, 'webobsidian-close-'));
await fs.mkdir(output, { recursive: true });
assert((await fs.realpath(output)).toLowerCase().startsWith(tempRoot.toLowerCase() + path.sep), 'Keep all Electron profiles and evidence inside Temp/.agents');
const require = createRequire(import.meta.url);
const executablePath = require('electron');
const results = [];
const bounded = (promise, label) => Promise.race([promise, new Promise((_, reject) => {
  const timer = setTimeout(() => reject(new Error(label)), 15000);
  timer.unref();
})]);

async function runCase(name, failFirstSave) {
  const fixture = path.join(output, name);
  const profile = path.join(fixture, 'profile');
  const vault = path.join(fixture, 'vault');
  const note = path.join(vault, 'close-barrier.md');
  const eventsFile = path.join(fixture, 'main-events.jsonl');
  await fs.mkdir(profile, { recursive: true });
  await fs.mkdir(vault);
  const original = '# Close barrier\n\nDisposable native fixture.\n';
  const marker = failFirstSave ? ' FAILURE-RETAINED-DRAFT' : ' DIRTY-SAVED-BY-CLOSE';
  await fs.writeFile(note, original);
  await fs.writeFile(path.join(profile, 'desktop-config.json'), JSON.stringify({ vaultPath: vault, trustedPlugins: false }));
  const bootstrap = path.join(fixture, 'bootstrap.cjs');
  const bootstrapSource = String.raw`
const { app, dialog, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const profile = ${JSON.stringify(profile)};
for (const name of ['session', 'crashes', 'electron-logs']) fs.mkdirSync(path.join(profile, name), {recursive:true});
app.setPath('userData', profile);
app.setPath('sessionData', path.join(profile, 'session'));
app.setPath('crashDumps', path.join(profile, 'crashes'));
app.setAppLogsPath(path.join(profile, 'electron-logs'));
const record = (type, detail = {}) => fs.appendFileSync(${JSON.stringify(eventsFile)}, JSON.stringify({type, at:Date.now(), ...detail})+'\n');
record('isolated-profile', {userData:app.getPath('userData'), sessionData:app.getPath('sessionData')});
dialog.showErrorBox = (title, message) => record('error-box', {title, message});
ipcMain.on('desktop:close-result', (_event, token, result) => record('close-result', {token, result}));
app.on('browser-window-created', (_event, window) => {
  window.on('close', () => record('native-close'));
  window.on('closed', () => record('window-closed', {disk:fs.readFileSync(${JSON.stringify(note)}, 'utf8')}));
});
app.on('will-quit', () => record('will-quit'));
require(${JSON.stringify(entry)});
`;
  new Script(bootstrapSource, { filename: bootstrap });
  await fs.writeFile(bootstrap, bootstrapSource);
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  delete environment.WEBOBSIDIAN_INITIAL_VAULT;
  let application, nativeProcess, page, releaseSave;
  let mode = 'gate';
  let capturedSave;
  const saveStarted = new Promise(resolve => { capturedSave = resolve; });
  const errors = [], consoleErrors = [];
  const readEvents = async () => (await fs.readFile(eventsFile, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const started = Date.now();
  try {
    application = await _electron.launch({ executablePath, args: [bootstrap, '--user-data-dir=' + profile],
      cwd: fixture, env: environment, timeout: 30000 });
    nativeProcess = application.process();
    nativeProcess.stdout?.on('data', chunk => { void fs.appendFile(path.join(fixture, 'electron-stdout.log'), chunk); });
    nativeProcess.stderr?.on('data', chunk => { void fs.appendFile(path.join(fixture, 'electron-stderr.log'), chunk); });
    page = await application.firstWindow();
    page.on('pageerror', error => errors.push(error.stack ?? error.message));
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 30000 });
    await page.locator('.workspace-launcher').waitFor();
    const isolation = await application.evaluate(({ app }) => ({ userData: app.getPath('userData'),
      sessionData: app.getPath('sessionData'), electron: process.versions.electron, chromium: process.versions.chrome }));
    assert.equal(path.resolve(isolation.userData), profile);
    assert.equal(path.resolve(isolation.sessionData), path.join(profile, 'session'));
    const settings = JSON.parse(await fs.readFile(path.join(profile, 'server-data/settings.json'), 'utf8'));
    assert.equal(path.resolve(settings.vault.path), vault);
    assert.match(await fs.readFile(path.join(profile, 'logs/server.log'), 'utf8'), new RegExp(vault.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    await page.keyboard.press('Control+o');
    await page.locator('.palette-input').fill('close-barrier');
    await page.keyboard.press('Enter');
    await page.locator('.cm-content').first().waitFor();
    await page.route('**/api/files/content', async route => {
      if (route.request().method() !== 'PUT' || route.request().postDataJSON()?.path !== 'close-barrier.md') return route.continue();
      if (mode === 'gate') {
        const decision = await new Promise(resolve => { releaseSave = resolve; capturedSave(); });
        if (decision === 'fail') return route.fulfill({ status: 507, json: { error: 'CONTROLLED-CLOSE-SAVE-FAILURE' } });
      } else if (mode === 'reject') return route.fulfill({ status: 507, json: { error: 'CONTROLLED-CLOSE-SAVE-FAILURE' } });
      await route.continue();
    });
    await page.locator('.cm-content').first().click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText(marker);
    assert.equal(await fs.readFile(note, 'utf8'), original, 'Draft must still be dirty before requesting native close');
    await application.evaluate(({ BrowserWindow }) => { setTimeout(() => BrowserWindow.getAllWindows()[0].close(), 0); });
    await bounded(saveStarted, 'Native close did not attempt to persist the dirty note');
    assert((await readEvents()).some(event => event.type === 'native-close'));
    assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1, 'Window must remain alive while save acknowledgement is pending');
    assert.equal(await fs.readFile(note, 'utf8'), original, 'Pending intercepted save must not have reached disk');
    assert.equal(await page.evaluate(() => document.getElementById('root').inert), true, 'Close barrier must suspend editing until save settles');
    if (failFirstSave) {
      mode = 'reject';
      releaseSave('fail');
      await expect.poll(async () => (await readEvents()).some(event => event.type === 'error-box' && event.message.includes('CONTROLLED-CLOSE-SAVE-FAILURE')), { timeout: 10000 }).toBe(true);
      assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
      assert.equal(page.isClosed(), false);
      await page.waitForFunction(() => !document.getElementById('root').inert);
      assert((await page.locator('.cm-content').first().innerText()).includes(marker), 'Failed close must retain the dirty draft');
      assert.equal(await fs.readFile(note, 'utf8'), original, 'Failed save must preserve original disk bytes');
      assert.equal((await page.request.get(new URL(page.url()).origin + '/healthz')).status(), 200, 'Failed close must preserve the server');
      const events = await readEvents();
      assert(events.some(event => event.type === 'close-result' && event.result.ok === false));
      assert(!events.some(event => event.type === 'window-closed' || event.type === 'will-quit'));
      await page.screenshot({ path: path.join(fixture, 'failed-close-retained.png') });
      console.log('[packaged-close] controlled save failure retained window, draft, original disk bytes and server');
      mode = 'allow';
    } else releaseSave('allow');
    const closed = application.waitForEvent('close', { timeout: 15000 });
    if (failFirstSave) await application.evaluate(({ BrowserWindow }) => { setTimeout(() => BrowserWindow.getAllWindows()[0].close(), 0); });
    await closed;
    const disk = await fs.readFile(note, 'utf8');
    assert(disk.includes(marker), 'Native close must persist the dirty draft before exit');
    const events = await readEvents();
    assert(events.some(event => event.type === 'close-result' && event.result.ok === true));
    assert(events.some(event => event.type === 'window-closed' && event.disk === disk), 'Disk must already match when the real window closes');
    assert(events.some(event => event.type === 'will-quit'));
    assert.deepEqual(errors, [], 'Native production renderer must have zero uncaught errors');
    assert.deepEqual(consoleErrors.filter(message => !failFirstSave || !message.includes('507 (Insufficient Storage)')), [], 'No unexpected native renderer console errors');
    const result = { name, passed: true, failFirstSave, elapsedMs: Date.now() - started, isolation,
      fixture, profile, vault, marker, disk, errors, consoleErrors, events };
    await fs.writeFile(path.join(fixture, 'result.json'), JSON.stringify(result, null, 2));
    results.push(result);
    console.log('[packaged-close] ' + name + ' passed: dirty draft saved on actual native close');
  } catch (error) {
    await page?.screenshot({ path: path.join(fixture, 'failure.png') }).catch(() => {});
    await fs.writeFile(path.join(fixture, 'failure.txt'), String(error.stack ?? error));
    throw error;
  } finally {
    releaseSave?.('allow');
    mode = 'allow';
    if (application && nativeProcess?.exitCode === null) await application.close().catch(() => {});
  }
}

try {
  await runCase('dirty-native-close', false);
  await runCase('failed-save-retains-window', true);
  await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ passed: true, desktop, executablePath, results }, null, 2));
  console.log('Packaged native close barrier passed: real Electron main/preload/SPA, isolated profiles/Vaults, dirty close disk persistence and controlled failure retention/retry.');
} catch (error) {
  await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ passed: false, desktop, executablePath, results, error: String(error.stack ?? error) }, null, 2));
  throw error;
}
