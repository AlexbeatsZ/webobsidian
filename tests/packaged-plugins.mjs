import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const repo = fileURLToPath(new URL('..', import.meta.url)),
  base = path.join(os.tmpdir(), '.agents');
const build = path.resolve(
  process.argv[2] ?? path.join(base, 'meta-obsidian-plugin-build')
);
assert.ok(build.startsWith(path.resolve(base) + path.sep));
await fs.mkdir(base, { recursive: true });
await fs.writeFile(path.join(build, 'package.json'), '{"type":"module"}');
for (const [target, source] of [
  ['node_modules', 'node_modules'],
  ['server/node_modules', 'server/node_modules'],
]) {
  try {
    await fs.symlink(
      path.join(repo, source),
      path.join(build, target),
      'junction'
    );
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
}
const temp = await fs.mkdtemp(path.join(base, 'meta-obsidian-plugin-package-')),
  vault = path.join(temp, 'vault'),
  data = path.join(temp, 'data');
const pluginDir = path.join(vault, '.obsidian/plugins/fixture');
await fs.mkdir(pluginDir, { recursive: true });
await fs.mkdir(data);
await fs.writeFile(
  path.join(vault, 'fixture.md'),
  '# Plugin acceptance\n\nplain\n\n```fixture\nhello\n```\n\nend'
);
await fs.writeFile(
  path.join(vault, '.obsidian/community-plugins.json'),
  '["fixture"]'
);
await fs.writeFile(
  path.join(pluginDir, 'manifest.json'),
  JSON.stringify({ id: 'fixture', name: 'Packaged fixture', version: '1.0.0' })
);
await fs.writeFile(
  path.join(pluginDir, 'main.js'),
  `const {Plugin}=require('obsidian');module.exports=class extends Plugin {async onload(){const data=await this.loadData();const el=document.createElement('div');el.id='plugin-loaded';el.textContent=data?.value||'initial';document.body.append(el);this.register(()=>el.remove());this.addCommand({id:'persist',name:'Persist fixture',callback:()=>this.saveData({value:'persisted'})});this.registerMarkdownCodeBlockProcessor('fixture',(source,el)=>el.textContent='RESULT:'+source.trim());this.addCommand({id:'edit',name:'Edit fixture',editorCallback:ed=>ed.replaceSelection('PLUGIN')});}}`
);
await fs.writeFile(
  path.join(data, 'shares.json'),
  JSON.stringify([{ id: 'plain', path: 'fixture.md', enabled: true }])
);
const probe = createServer();
await new Promise((r) => probe.listen(0, '127.0.0.1', r));
const port = probe.address().port;
await new Promise((r) => probe.close(r));
const server = spawn(
  process.execPath,
  [path.join(build, 'server/dist/index.js')],
  {
    cwd: build,
    windowsHide: true,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      DATA_DIR: data,
      VAULT_PATH: vault,
      ALLOWED_ROOTS: vault,
      NODE_ENV: 'production',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  }
);
let logs = '';
server.stdout.on('data', (v) => (logs += v));
server.stderr.on('data', (v) => (logs += v));
let browser;
try {
  const url = 'http://127.0.0.1:' + port;
  for (let attempt = 0; ; attempt++) {
    if (server.exitCode !== null) throw new Error(logs);
    if (
      await fetch(url + '/healthz')
        .then((r) => r.ok)
        .catch(() => false)
    )
      break;
    if (attempt > 100) throw new Error('Server startup timeout: ' + logs);
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal((await fetch(url + '/api/plugins/fixture/data')).status, 401);
  const publicCsp = (await fetch(url + '/share/plain')).headers.get(
    'content-security-policy'
  );
  assert.ok(!publicCsp.includes("'unsafe-eval'"));
  assert.ok(
    !publicCsp
      .split(';')
      .find((s) => s.startsWith('script-src'))
      .includes('blob:')
  );
  assert.ok(
    !publicCsp
      .split(';')
      .find((s) => s.startsWith('worker-src'))
      .includes('blob:')
  );
  const privateCsp = (await fetch(url + '/')).headers.get(
    'content-security-policy'
  );
  assert.ok(privateCsp.includes("'unsafe-eval'"));
  browser = await chromium.launch({
    executablePath:
      process.env.RENDER_TEST_BROWSER ??
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true,
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/favicon.ico', (r) => r.fulfill({ status: 204 }));
  await page.request.post(url + '/auth/login', {
    data: { password: '123456' },
  });
  await page.request.post(url + '/auth/change-password', {
    data: { currentPassword: '123456', newPassword: 'isolated-plugin-fixture' },
  });
  await page.goto(url + '/note/fixture.md');
  await page.waitForSelector('#plugin-loaded');
  assert.equal(await page.textContent('#plugin-loaded'), 'initial');
  await page.waitForSelector('.plugin-code-block');
  assert.match(await page.textContent('.plugin-code-block'), /RESULT:hello/);
  await page.evaluate(() =>
    window.app.commands.executeCommandById('fixture:persist')
  );
  await page.waitForFunction(() => window.app.plugins.getPlugin('fixture'));
  for (let i = 0; ; i++) {
    const json = await fs
      .readFile(path.join(pluginDir, 'data.json'), 'utf8')
      .then(JSON.parse)
      .catch(() => null);
    if (json?.value === 'persisted') break;
    assert.ok(i < 30);
    await new Promise((r) => setTimeout(r, 100));
  }
  await page.reload();
  await page.waitForSelector('#plugin-loaded');
  assert.equal(await page.textContent('#plugin-loaded'), 'persisted');
  const raw = await page.request.get(
    url + '/api/files/content?path=fixture.md&raw=1'
  );
  assert.match(await raw.text(), /# Plugin acceptance/);
  assert.ok(!(await raw.text()).startsWith('{'));
  const escape = await page.request.post(url + '/api/plugins/adapter', {
    data: { op: 'write', path: '../escape', content: 'bad' },
  });
  assert.equal(escape.status(), 400);
  await page.evaluate(() => window.app.plugins.disablePluginAndSave('fixture'));
  await page.waitForSelector('#plugin-loaded', { state: 'detached' });
  assert.deepEqual(
    JSON.parse(
      await fs.readFile(
        path.join(vault, '.obsidian/community-plugins.json'),
        'utf8'
      )
    ),
    []
  );
  assert.deepEqual(errors, []);
  console.log(
    'Packaged plugin acceptance passed: authenticated loading, CSP, fenced rendering, durable data, raw resources, traversal guard, live unload.'
  );
} finally {
  await browser?.close();
  server.kill();
  await new Promise((r) =>
    server.exitCode !== null ? r() : server.once('exit', r)
  );
  await fs.rm(temp, {
    recursive: true,
    force: true,
    maxRetries: 12,
    retryDelay: 150,
  });
}
