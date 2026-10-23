import { mkdir, writeFile, access, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const android = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(android, '.runtime');
const version = '24.22.1-0';
let ready = false;
try {
  await access(path.join(directory, 'bin/arm64-v8a/libnode.so'));
  ready = (await readFile(path.join(directory, 'version'), 'utf8')).trim() === version;
} catch { /* First project-local download. */ }
await mkdir(directory, { recursive: true });
const download = async (url, target) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${url}`);
  await writeFile(target, new Uint8Array(await response.arrayBuffer()));
};
if (!ready) {
  const archive = path.join(directory, 'runtime.zip');
  await download(`https://github.com/fogtape/nodejs-mobile/releases/download/v${version}/nodejs-mobile-android-${version}.zip`, archive);
  const extracted = spawnSync('tar', ['-xf', archive, '-C', directory], { stdio: 'inherit' });
  if (extracted.status !== 0) throw new Error('Could not extract runtime archive with tar');
}
await download('https://raw.githubusercontent.com/nodejs/node/v24.22.1/LICENSE', path.join(directory, 'NODE-LICENSE.txt'));
await download('https://raw.githubusercontent.com/fogtape/nodejs-mobile/recipe/NOTICE.md', path.join(directory, 'MOBILE-NOTICE.md'));
await writeFile(path.join(directory, 'version'), version + '\n');
console.log(`Project-local mobile runtime ${version} ready (upstream distribution: prerelease).`);
