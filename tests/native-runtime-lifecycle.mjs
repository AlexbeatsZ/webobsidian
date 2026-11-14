import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const entry = path.resolve(process.argv[2] ?? 'desktop/.gen/server/dist/index.mjs');
const directory = await fs.mkdtemp('/tmp/.agents/webobsidian-lifecycle-');
const vault = path.join(directory, 'vault 😃, chosen');
await fs.mkdir(vault);
await fs.writeFile(path.join(vault, 'note.md'), '# fixture\n');

async function start(data, selected = vault, embedded = false) {
  const child = spawn(process.execPath, [entry], {
    env: { ...process.env, PORT: '0', DATA_DIR: data, VAULT_PATH: selected,
      ALLOWED_ROOTS_JSON: JSON.stringify([directory]), WEBOBSIDIAN_REQUIRE_VAULT: '1', WEBOBSIDIAN_EMBEDDED: embedded ? '1' : '0' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let log = '';
  child.stdout.on('data', chunk => { log += chunk; });
  child.stderr.on('data', chunk => { log += chunk; });
  const exited = once(child, 'exit');
  return { child, exited, log: () => log };
}

for (const signal of ['ipc', 'SIGTERM']) {
  const data = path.join(directory, signal);
  const host = await start(data);
  try {
    const endpoint = path.join(data, 'operations-endpoint.json');
    let address;
    for (let attempt = 0; attempt < 300; attempt++) {
      assert.equal(host.child.exitCode, null, host.log());
      try {
        address = JSON.parse(await fs.readFile(endpoint, 'utf8'));
        const response = await fetch(address.url + '/healthz');
        assert.equal((await response.json()).pid, host.child.pid);
        if (response.ok) break;
      } catch { /* Waiting for endpoint publication. */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert(address, host.log());
    assert.equal(address.protocol, 1);
    assert.equal(address.pid, host.child.pid);
    const identity = await (await fetch(address.url + '/api/vault-identity')).json();
    const response = await fetch(address.url + '/api/files/content?path=note.md', { headers: { 'X-Vault-Identity': identity.vault } });
    assert.equal(response.status, 200, await response.text());
    if (signal === 'ipc') host.child.send({ type: 'shutdown' }); else host.child.kill(signal);
    const [code] = await host.exited;
    assert.equal(code, 0, host.log());
    await assert.rejects(fs.stat(endpoint), { code: 'ENOENT' });
    assert.equal(JSON.parse(await fs.readFile(path.join(data, 'qmd-index.json'), 'utf8')).root, vault);
    console.log(`${signal} startup, Unicode/comma path, graceful flush and endpoint removal passed`);
  } finally { if (host.child.exitCode === null) host.child.kill('SIGKILL'); }
}

const missing = path.join(directory, 'missing');
const invalid = await start(path.join(directory, 'invalid'), missing);
const [code] = await invalid.exited;
assert.equal(code, 1);
await assert.rejects(fs.stat(missing), { code: 'ENOENT' });
console.log('Missing native Vault fails without creating an implicit Vault');
const embeddedData = path.join(directory, 'embedded-invalid');
const embedded = await start(embeddedData, missing, true);
try {
  let failure;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { failure = JSON.parse(await fs.readFile(path.join(embeddedData, 'operations-endpoint.starting.json'), 'utf8')); break; }
    catch { await new Promise(resolve => setTimeout(resolve, 50)); }
  }
  assert.equal(failure.pid, embedded.child.pid);
  assert.match(failure.failure, /existing directory/);
  assert.equal(embedded.child.exitCode, null, 'Embedded startup failure keeps the native recovery UI alive');
  embedded.child.kill('SIGTERM');
  assert.equal((await embedded.exited)[0], 0);
  console.log('Embedded startup fault reports its failure and retains the Activity process for explicit recovery');
} finally { if (embedded.child.exitCode === null) embedded.child.kill('SIGKILL'); }
await fs.rm(directory, { recursive: true });
