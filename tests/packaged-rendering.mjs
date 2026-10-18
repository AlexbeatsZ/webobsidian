// Run after isolated builds to <buildRoot>/server/{dist,public}.
// It starts a separate server with a disposable vault, never the user's app.
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const repo = fileURLToPath(new URL('..', import.meta.url));
const tempBase = path.join(os.tmpdir(), '.agents');
const buildRoot = path.resolve(process.argv[2] ?? path.join(tempBase, 'meta-obsidian-build'));
assert.ok(buildRoot.startsWith(path.resolve(tempBase) + path.sep), 'Use an isolated Temp/.agents build');
await fs.mkdir(tempBase, { recursive: true });
await fs.writeFile(path.join(buildRoot, 'package.json'), '{"type":"module"}');
try { await fs.symlink(path.join(repo, 'node_modules'), path.join(buildRoot, 'node_modules'), 'junction'); }
catch (error) { if (error.code !== 'EEXIST') throw error; }
try { await fs.symlink(path.join(repo, 'server/node_modules'), path.join(buildRoot, 'server/node_modules'), 'junction'); }
catch (error) { if (error.code !== 'EEXIST') throw error; }
const fixture = await fs.mkdtemp(path.join(tempBase, 'meta-obsidian-package-test-'));
const vault = path.join(fixture, 'vault'), data = path.join(fixture, 'data');
await fs.mkdir(vault); await fs.mkdir(data);
const source = '\ufeff# Root\r\n\r\n**public**<br>second\n\n![[nested#Allowed]]\n\n![[pixel.png]]\n\n| A | B |\n| --- | --- |\n| x | y |\n\n$$\n\\ce{2 H2 + O2 -> 2 H2O} + \\mathbb{R}\n$$';
const canvas = JSON.stringify({ nodes: [
  { id: 'text', type: 'text', x: 0, y: 0, width: 300, height: 180, text: '**canvas card**<br>second\n\n$x^2$' },
  { id: 'file', type: 'file', x: 340, y: 0, width: 300, height: 220, file: 'nested.md', subpath: '#Allowed' },
], edges: [] });
await Promise.all([
  fs.writeFile(path.join(vault, 'root.md'), source),
  fs.writeFile(path.join(vault, 'nested.md'), '# Hidden\nprivate-section-marker\n\n# Allowed\n**child**\n'),
  fs.writeFile(path.join(vault, 'test.canvas'), canvas),
  fs.writeFile(path.join(vault, 'pixel.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64')),
  fs.writeFile(path.join(data, 'shares.json'), JSON.stringify([
    { id: 'plain', path: 'root.md', enabled: true }, { id: 'canvas', path: 'test.canvas', enabled: true },
    { id: 'locked', path: 'root.md', enabled: true, passwordHash: 'locked-fixture' },
  ])),
]);
const portProbe = createServer(); await new Promise(resolve => portProbe.listen(0, '127.0.0.1', resolve));
const port = portProbe.address().port; await new Promise(resolve => portProbe.close(resolve));
const server = spawn(process.execPath, [path.join(buildRoot, 'server/dist/index.js')], {
  cwd: buildRoot, windowsHide: true,
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: data, VAULT_PATH: vault, ALLOWED_ROOTS: vault, NODE_ENV: 'production' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = ''; server.stdout.on('data', chunk => logs += chunk); server.stderr.on('data', chunk => logs += chunk);
let browser;
try {
  const base = 'http://127.0.0.1:' + port;
  for (let i = 0; ; i++) {
    if (server.exitCode !== null) throw new Error(logs);
    if (await fetch(base + '/healthz').then(r => r.ok).catch(() => false)) break;
    if (i > 80) throw new Error('Isolated server did not start: ' + logs);
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  const html = await fetch(base + '/share/plain').then(r => r.text());
  assert.match(html, /type="module".*assets\/share-/);
  assert.match(html, /--font-text-size/);
  const canvasHtml = await fetch(base + '/share/canvas').then(r => r.text());
  assert.ok(!canvasHtml.includes('private-section-marker'), 'SSR must respect Canvas subpaths');
  assert.equal((await fetch(base + '/public/shares/locked/render')).status, 401);
  browser = await chromium.launch({ executablePath: process.env.RENDER_TEST_BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const page = await browser.newPage();
  const errors = [], authenticatedRequests = [], externalRequests = [], mathAssets = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/')) authenticatedRequests.push(url.href);
    if (url.origin !== base) externalRequests.push(url.href);
    if (url.pathname.includes('/assets/mathjax-')) mathAssets.push(url.pathname);
  });
  await page.goto(base + '/share/plain');
  await page.locator('#shared-markdown .cm-note-embed .cm-strong').waitFor();
  await page.locator('#shared-markdown mjx-container[jax="SVG"]').waitFor();
  assert.equal(await page.locator('#shared-markdown mjx-container').getAttribute('data-mathjax-version'), '4.1.3');
  assert.equal(await page.locator('#shared-markdown [data-mml-node="merror"]').count(), 0);
  assert.ok(mathAssets.some(asset => asset.endsWith('/mhchem.js')));
  assert.ok(mathAssets.some(asset => asset.includes('/svg/dynamic/')));
  assert.equal(await page.locator('#shared-markdown .cm-html-break').count(), 1);
  assert.equal(await page.locator('#shared-markdown .cm-table').count(), 1);
  assert.equal(await page.locator('#shared-markdown [contenteditable="true"]').count(), 0);
  assert.ok(!(await page.textContent('body')).includes('private-section-marker'));
  const image = page.locator('#shared-markdown img.cm-embed-image').first();
  await image.waitFor(); await image.evaluate(img => img.decode());
  await page.goto(base + '/share/canvas');
  await page.locator('[data-share-node="text"] .cm-strong').waitFor();
  await page.locator('[data-share-node="file"] .cm-strong').waitFor();
  await page.locator('[data-share-node="text"] mjx-container[data-mathjax-version="4.1.3"]').waitFor();
  assert.ok(!(await page.textContent('body')).includes('private-section-marker'));
  assert.equal(await page.locator('[data-share-node] [contenteditable="true"]').count(), 0);
  assert.deepEqual(authenticatedRequests, []);
  assert.deepEqual(externalRequests, []);
  assert.deepEqual(errors, []);
  const noJs = await browser.newContext({ javaScriptEnabled: false });
  const fallback = await noJs.newPage(); await fallback.goto(base + '/share/plain');
  assert.ok((await fallback.textContent('body')).includes('public'));
  await noJs.close();
  assert.equal(await fs.readFile(path.join(vault, 'root.md'), 'utf8'), source);
  console.log('Packaged acceptance passed: SSR + manifest + readonly Markdown/Canvas + scoped media + password boundary + no-JS fallback + unchanged source');
} finally {
  await browser?.close(); server.kill();
  await new Promise(resolve => server.exitCode !== null ? resolve() : server.once('exit', resolve));
  assert.ok(fixture.startsWith(path.resolve(tempBase) + path.sep));
  await fs.rm(fixture, { recursive: true, force: true });
}
