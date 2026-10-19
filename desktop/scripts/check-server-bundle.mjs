import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The server is distributed as one .mjs without its node_modules directory.
// A UMD factory can hide require() from esbuild and leave calls such as
// require2('./impl/format') behind. Reject these literal relative dependencies
// statically; this check never imports or starts the server.
export function checkServerBundle(file) {
  const source = readFileSync(file, 'utf8');
  const dependencies = [...source.matchAll(/\b(?:__)?require\d*\(\s*['"](\.{1,2}\/[^'"]+)['"]/g)]
    .map((match) => match[1]);
  if (dependencies.length) {
    throw new Error(`Standalone server bundle contains unresolved relative require calls: ${[...new Set(dependencies)].join(', ')}`);
  }
  console.log('[desktop] static standalone server bundle check passed');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkServerBundle(process.argv[2] ?? fileURLToPath(new URL('../.gen/server/dist/index.mjs', import.meta.url)));
}
