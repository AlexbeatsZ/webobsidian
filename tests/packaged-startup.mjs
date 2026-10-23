// Production-entry regression: use a packaged server and disposable data, never a live Vault.
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { chromium } from '@playwright/test';

const resources = path.resolve(process.argv[2] ?? 'desktop/.gen');
const entry = path.join(resources, 'server/dist/index.mjs');
await fs.access(entry);
const fixture = await fs.mkdtemp(path.join(os.tmpdir(), '.agents/meta-obsidian-startup-'));
const vault = path.join(fixture, 'vault'), data = path.join(fixture, 'data');
await fs.mkdir(vault); await fs.mkdir(data);
await fs.writeFile(path.join(vault, 'acceptance.md'), '# Production startup\n\nEditable fixture.\n');
await fs.writeFile(path.join(vault, 'legacy#title.md'), '# Existing external file\n');
await fs.writeFile(path.join(vault, 'tag-filter.md'), '---\ntags: [化学/物理, 笔记]\n---\n\n反应记录\n');
await fs.writeFile(path.join(vault, 'tag-old.md'), '---\ntags: [化学, 笔记, 旧版/归档]\n---\n\n反应记录\n');
const native = path.join(vault, '.obsidian/webobsidian');
await fs.mkdir(path.join(native, 'blocks'), { recursive: true });
await fs.mkdir(path.join(native, 'menus'), { recursive: true });
await fs.mkdir(path.join(vault, '.obsidian/plugins/obsidian-latex-suite'), { recursive: true });
await fs.writeFile(path.join(vault, '.obsidian/plugins/obsidian-latex-suite/data.json'), JSON.stringify({
  snippets: 'export default [{trigger:"zzfixture", replacement:"SNIPPET-OK", options:"tA"}]',
}));
await fs.writeFile(path.join(native, 'menus/menu.jsonc'), JSON.stringify({ version: 1,
  items: [{ id: 'custom:acceptance', title: 'Acceptance menu', when: { contexts: ['tab'] }, command: 'source' }],
}));
await fs.mkdir(path.join(vault, 'Templates'));
await fs.writeFile(path.join(native, 'automation.jsonc'), JSON.stringify({ version: 1,
  commands: [{ id: 'user:acceptance', name: 'Acceptance value', enabled: true, code: 'return "COMMAND-OK";' }],
  templates: { folder: 'Templates', bindings: [{ id: 'template:acceptance', name: 'Acceptance template', path: 'Templates/Fixture.md' }], folderRules: [] },
}));
await fs.writeFile(path.join(vault, 'Templates/Fixture.md'), 'TEMPLATE-OK <% command "user:acceptance" {} %>');
await fs.writeFile(path.join(native, 'blocks/blocks.jsonc'), JSON.stringify({ version: 1,
  definitions: [{ names: ['acceptance-card'], classes: ['acceptance-card'] }],
}));
await fs.writeFile(path.join(vault, '化学实验.md'), '# 化学实验\n\n反应记录 #实验/化学\n');
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64');
await fs.writeFile(path.join(vault, 'used.png'), pixel);
await fs.writeFile(path.join(vault, 'unused.png'), pixel);
await fs.writeFile(path.join(vault, 'image-reference.md'), '![[used.png]]');
await fs.writeFile(path.join(vault, 'features.md'), [
  '# Features', '', '$$x^2$$ ^eq-fixture', '', 'Reference [[#^eq-fixture]]', '',
  '> $$', '> \\frac{a}{b}', '> $$', '', '####### Local title', '',
  '[acceptance-card]', 'Styled block.', '', '```js-widget', 'container.textContent = "JS-WIDGET-OK";', '```', '', 'end',
].join('\n'));
const probe = createServer();
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const child = spawn(process.execPath, [entry], {
  cwd: fixture, windowsHide: true,
  env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), DATA_DIR: data,
    VAULT_PATH: vault, ALLOWED_ROOTS: vault, COOKIE_SECURE: 'false',
    NODE_ENV: 'production', WEBOBSIDIAN_PASSWORD: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '', browser;
child.stdout.on('data', chunk => { logs += chunk; });
child.stderr.on('data', chunk => { logs += chunk; });
try {
  const base = 'http://127.0.0.1:' + port;
  const deadline = Date.now() + 20000;
  for (;;) {
    if (child.exitCode !== null) throw Error('Packaged server exited: ' + logs);
    if (await fetch(base + '/healthz').then(r => r.ok).catch(() => false)) break;
    if (Date.now() > deadline) throw Error('Fixture server startup timed out: ' + logs);
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  browser = await chromium.launch({
    executablePath: process.env.RENDER_TEST_BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true,
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.stack));
  await page.goto(base, { waitUntil: 'networkidle' });
  assert.deepEqual(errors, [], 'The real production entry must evaluate without initialization errors');
  assert(await page.locator('#root').innerText(), 'React must mount a visible login/workspace');
  const login = await page.request.post(base + '/auth/login', { data: { password: '123456' } });
  assert.equal(login.status(), 200);
  const change = await page.request.post(base + '/auth/change-password', {
    data: { currentPassword: '123456', newPassword: 'fixture-only-password' },
  });
  assert.equal(change.status(), 200);
  for (const query of ['#化学 #笔记 -#旧版', 'tag:#化学 tags:笔记 -tag:旧版']) {
    const response = await page.request.get(base + '/api/search?q=' + encodeURIComponent(query));
    assert.deepEqual((await response.json()).hits.map(hit => hit.path), ['tag-filter.md']);
  }
  assert.equal((await page.request.put(base + '/api/files/content', { data: { path: 'bad#title.md', content: '# New\n', createOnly: true } })).status(), 400);
  assert.equal((await page.request.patch(base + '/api/files/rename', { data: { from: 'acceptance.md', to: 'bad#rename.md' } })).status(), 400);
  assert.equal((await page.request.post(base + '/api/files/copy', { data: { from: 'acceptance.md', to: 'bad#copy.md' } })).status(), 400);
  assert.equal((await page.request.put(base + '/api/files/content', { data: { path: 'legacy#title.md', content: '# Existing external file\n\nStill editable.\n' } })).status(), 200);
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.workspace-launcher').waitFor();
  await page.keyboard.press('Control+o');
  await page.locator('.palette-input').fill('acceptance');
  await page.keyboard.press('Enter');
  await page.locator('.cm-content').first().waitFor();
  await page.locator('.cm-content').first().click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' Saved through production UI.');
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(1000);
  assert.match(await fs.readFile(path.join(vault, 'acceptance.md'), 'utf8'), /Saved through production UI\./);
  await page.keyboard.press('Enter');
  await page.keyboard.type('zzfixture');
  await page.waitForFunction(() => document.querySelector('.cm-content')?.textContent.includes('SNIPPET-OK'));
  const runCommand = async name => {
    await page.keyboard.press('Control+p');
    await page.locator('.palette-input').fill(name);
    await page.getByText(name, { exact: true }).click();
  };
  await runCommand('Acceptance template');
  await page.waitForFunction(() => document.querySelector('.cm-content')?.textContent.includes('TEMPLATE-OK COMMAND-OK'));
  await page.keyboard.press('Control+s');
  await page.keyboard.press('Control+o');
  await page.locator('.palette-input').fill('features');
  await page.keyboard.press('Enter');
  await page.locator('.cm-body-heading').waitFor();
  await page.locator('.interactive-js-render').filter({ hasText: 'JS-WIDGET-OK' }).waitFor();
  await page.locator('.acceptance-card').waitFor();
  await page.locator('.cm-equation-number').first().waitFor();
  assert.equal(await page.locator('.cm-wikilink').filter({ hasText: '(1-1)' }).count(), 1);
  await page.locator('.view-mode-trigger').click();
  await page.getByRole('menuitemcheckbox', { name: '阅读视图', exact: true }).click();
  assert.equal(await page.locator('.cm-content').first().getAttribute('contenteditable'), 'false');
  await page.locator('.view-mode-trigger').click();
  await page.getByRole('menuitemcheckbox', { name: '源码模式', exact: true }).click();
  assert.match(await page.locator('.cm-content').first().innerText(), /\^eq-fixture/);
  assert.equal(await page.locator('.interactive-js-render').count(), 0);
  const search = await page.request.get(base + '/api/search?q=huaxue&mode=pinyin');
  assert((await search.json()).hits.some(hit => hit.path === '化学实验.md'), 'Native pinyin search');
  await page.locator('.tab-bar [role="tab"][aria-selected="true"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Acceptance menu', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  const scan = await page.request.post(base + '/api/attachments/scan', { data: { excludeDirectories: [], excludeExtensions: [] } });
  assert.equal(scan.status(), 200);
  const preview = await scan.json();
  assert(preview.candidates.some(item => item.path === 'unused.png'), 'Unused attachment is a scan candidate');
  assert(!preview.candidates.some(item => item.path === 'used.png'), 'Referenced attachment is protected');
  await fs.access(path.join(vault, 'unused.png')); // Preview alone must not delete anything.
  await page.getByRole('button', { name: '新建右侧标签页' }).click();
  await page.getByRole('tab', { name: '新标签页', exact: true }).waitFor();
  assert.equal(await page.locator('.ribbon-fixed button').count(), 4);
  assert.equal(await page.getByRole('button', { name: /Daily note/i }).count(), 0);
  assert.deepEqual(errors, [], 'No renderer errors during production load/edit/save');
  console.log('Packaged startup passed: production entry/login/edit/save, native snippet, command-backed template, JS widget, custom block, equation reference, body title, reading/source modes, pinyin search, configured menu, attachment preview/protection and right tabs.');
} finally {
  await browser?.close();
  child.kill();
  if (child.exitCode === null) await new Promise(resolve => child.once('exit', resolve));
  await fs.rm(fixture, { recursive: true, force: true });
}
