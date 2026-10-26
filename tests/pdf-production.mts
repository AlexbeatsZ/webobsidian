import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { chromium, expect } from '@playwright/test';
import { makePdfFixture } from './browser/fixtures/pdf';

const [serverBundle, webBuild] = process.argv.slice(2);
if (!serverBundle || !webBuild) throw new Error('Usage: tsx tests/pdf-production.mts <server index.mjs> <web production directory>');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), '.agents/pdf-production-'));
const server = path.join(temporary, 'server'), vault = path.join(temporary, 'vault'), data = path.join(temporary, 'data');
await fs.mkdir(path.join(server, 'dist'), { recursive: true });
await fs.mkdir(vault); await fs.mkdir(data);
await fs.copyFile(serverBundle, path.join(server, 'dist/index.mjs'));
await fs.symlink(path.resolve(webBuild), path.join(server, 'public'), process.platform === 'win32' ? 'junction' : 'dir');
await fs.writeFile(path.join(vault, 'paper.pdf'), makePdfFixture({ pages: 12 }));
await fs.writeFile(path.join(data, 'uistate.json'), JSON.stringify({ tabs: [{ path: 'paper.pdf', title: 'paper.pdf' }], activePath: 'paper.pdf', rightPanel: 'outline', rightOpen: true }));
const probe = createServer(); await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
const port = (probe.address() as { port: number }).port;
await new Promise<void>(resolve => probe.close(() => resolve()));
const processHandle = spawn(process.execPath, [path.join(server, 'dist/index.mjs')], { cwd: temporary, windowsHide: true,
  env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), VAULT_PATH: vault, ALLOWED_ROOTS: vault, DATA_DIR: data, NODE_ENV: 'production' }, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; processHandle.stdout.on('data', chunk => { logs += chunk; }); processHandle.stderr.on('data', chunk => { logs += chunk; });
let browser;
try {
  const base = `http://127.0.0.1:${port}`;
  await expect.poll(() => fetch(base + '/healthz').then(response => response.ok).catch(() => false), { timeout: 20000 }).toBe(true);
  browser = await chromium.launch({ executablePath: process.env.RENDER_TEST_BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1480, height: 860 } });
  const errors: string[] = [], failedAssets: string[] = [], assetUrls: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.url().includes('/assets/') || response.url().includes('/pdfjs-assets/')) { assetUrls.push(response.url()); if (!response.ok()) failedAssets.push(response.url()); } });
  for (const directory of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
    const filenames = await fs.readdir(path.join(webBuild, 'pdfjs-assets', directory));
    const filename = filenames.find(name => !name.startsWith('LICENSE'));
    expect(filename).toBeTruthy();
    const response = await fetch(`${base}/pdfjs-assets/${directory}/${filename}`);
    expect(response.ok).toBe(true);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(await fs.readFile(path.join(webBuild, 'pdfjs-assets', directory, filename!)));
  }
  await page.goto(base);
  await expect(page.getByRole('button', { name: /Chapter Two/ })).toBeVisible();
  await page.getByRole('button', { name: /Chapter Two/ }).click();
  await expect(page.getByRole('textbox', { name: 'PDF 页码' })).toHaveValue('2');
  await page.getByRole('button', { name: '缩略图', exact: true }).click();
  await page.getByRole('searchbox', { name: '搜索 PDF' }).click();
  await page.getByRole('searchbox', { name: '搜索 PDF' }).fill('needle');
  await expect(page.locator('.pdf-search [role="status"]')).toHaveText('1/12');
  await expect(page.locator('[data-thumbnail-page="2"] .pdf-match')).not.toHaveCount(0);
  await page.screenshot({ path: path.join(temporary, 'production-pdf.png') });
  expect(errors).toEqual([]); expect(failedAssets).toEqual([]);
  expect(assetUrls.some(url => /pdf\.worker.*\.mjs/.test(url))).toBe(true);
  await fs.writeFile(path.join(temporary, 'result.json'), JSON.stringify({ passed: true, errors, failedAssets, assetUrls, serverBundle, webBuild }, null, 2));
  console.log(JSON.stringify({ passed: true, temporary, assets: assetUrls.length }));
} finally {
  await browser?.close(); processHandle.kill();
  await fs.writeFile(path.join(temporary, 'server.log'), logs);
}
