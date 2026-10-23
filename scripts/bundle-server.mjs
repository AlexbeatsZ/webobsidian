import { build } from 'esbuild';
import { cpSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { checkServerBundle } from '../desktop/scripts/check-server-bundle.mjs';

/** Desktop and Android ship the same local backend and SPA, without node_modules. */
export async function bundleServer(repoDir, outputDir) {
  const entry = path.join(repoDir, 'server/dist/index.js');
  const publicDir = path.join(repoDir, 'server/public');
  if (!existsSync(entry) || !existsSync(publicDir)) throw new Error('Run npm run build in the isolated source directory first.');
  const require = createRequire(import.meta.url);
  const bundle = path.join(outputDir, 'dist/index.mjs');
  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(path.dirname(bundle), { recursive: true });
  await build({
    entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', target: 'node20',
    external: ['fsevents'],
    alias: { 'jsonc-parser': require.resolve('jsonc-parser/lib/esm/main.js') },
    outfile: bundle,
    banner: { js: "import{createRequire as ___cr}from'module';const require=___cr(import.meta.url);" },
    logLevel: 'info',
  });
  checkServerBundle(bundle);
  cpSync(publicDir, path.join(outputDir, 'public'), { recursive: true });
}
