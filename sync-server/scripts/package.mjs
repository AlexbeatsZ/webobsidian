import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, cp, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';

const root = fileURLToPath(new URL('..', import.meta.url));
const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const coreSource = JSON.parse(await readFile(path.join(root, 'core-source.json'), 'utf8'));
const coreRoot = fileURLToPath(new URL('..', import.meta.resolve('@alexbeatsz/file-sync-core')));
const corePackage = JSON.parse(await readFile(path.join(coreRoot, 'package.json'), 'utf8'));
const lock = JSON.parse(await readFile(path.join(root, '..', 'package-lock.json'), 'utf8'));
const lockedCore = lock.packages['node_modules/@alexbeatsz/file-sync-core'];
if (corePackage.version !== coreSource.version || metadata.dependencies?.['@alexbeatsz/file-sync-core'] !== coreSource.archive ||
    lockedCore?.version !== coreSource.version || lockedCore?.resolved !== coreSource.archive || !lockedCore?.integrity) {
  throw new Error('Pinned core source, installed module and dependency disagree');
}
const output = path.resolve(process.argv[2] ?? path.join(root, 'release', metadata.version));
await mkdir(output, { recursive: true });
const temporaryRoot = path.join(os.tmpdir(), '.agents');
await mkdir(temporaryRoot, { recursive: true });
const temporary = await mkdtemp(path.join(temporaryRoot, 'webobsidian-sync-package-'));
const folder = `webobsidian-sync-server-${metadata.version}`;
const stage = path.join(temporary, folder);
const target = path.join(stage, 'sync-server');
try {
  await mkdir(target, { recursive: true });
  for (const name of ['server.mjs', 'cli.mjs', 'protocol.mjs', 'gateway-route.mjs', 'shared-gateway.mjs', 'package.json', 'core-source.json', 'server.example.json', 'README.md']) {
    await cp(path.join(root, name), path.join(target, name));
  }
  // Copy the installed, pinned package. The release never resolves a sibling checkout.
  const bundledCore = path.join(target, 'node_modules/@alexbeatsz/file-sync-core');
  await mkdir(bundledCore, { recursive: true });
  for (const name of ['package.json', 'src', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'provenance.json']) {
    await cp(path.join(coreRoot, name), path.join(bundledCore, name), { recursive: true, dereference: true });
  }
  await cp(path.join(root, '..', 'LICENSE'), path.join(stage, 'LICENSE'));
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const dirty = execFileSync('git', ['status', '--porcelain', '--', 'sync-server'], { cwd: path.join(root, '..'), encoding: 'utf8' }).trim();
  if (dirty && !process.env.WEBOBSIDIAN_SYNC_ALLOW_DIRTY_BUILD) throw new Error('Commit sync-server sources before release packaging');
  await writeFile(path.join(stage, 'BUILD-INFO.json'), JSON.stringify({
    product: 'WebObsidian Sync Server', version: metadata.version, sourceCommit: commit, sourceDirty: Boolean(dirty),
    core: { ...coreSource, integrity: lockedCore.integrity }, node: process.version, platform: process.platform,
    entrypoint: 'sync-server/server.mjs', defaultPort: 18744, routePrefix: '/webobsidian-sync/v1/',
    requiresInstall: false, includesNodeRuntime: false,
  }, null, 2) + '\n');
  execFileSync('tar', ['-czf', path.join(output, folder + '.tar.gz'), '-C', temporary, folder], { stdio: 'inherit' });
  if (process.platform === 'win32') {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path.join(root, 'scripts/archive.ps1'),
      '-Source', stage, '-Destination', path.join(output, folder + '.zip')], { stdio: 'inherit', windowsHide: true });
  } else {
    execFileSync('zip', ['-q', '-r', path.join(output, folder + '.zip'), folder], { cwd: temporary, stdio: 'inherit' });
  }
  await cp(path.join(stage, 'BUILD-INFO.json'), path.join(output, 'BUILD-INFO.json'));
  console.log(JSON.stringify({ version: metadata.version, commit, output, core: coreSource }, null, 2));
} finally {
  if (path.dirname(temporary) !== temporaryRoot || !path.basename(temporary).startsWith('webobsidian-sync-package-')) throw new Error('Unsafe staging directory');
  await rm(temporary, { recursive: true, force: true });
}
