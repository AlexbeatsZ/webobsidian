// Build the desktop app artifacts that electron-builder packages:
//   1. dist/main.js + dist/preload.js  — the Electron main & preload (esbuild bundles)
//   2. .gen/server/dist/index.mjs      — the whole Express server as ONE bundled ESM file
//   3. .gen/server/public/             — the built web SPA (copied from server/public)
//
// Prereq: the repo-root `npm run build` must have run first (it produces
// server/dist + server/public). We bundle the COMPILED server (server/dist/index.js),
// not the TS source, so the `.js` import specifiers resolve cleanly.
import { build } from 'esbuild';
import { cpSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { checkServerBundle } from './check-server-bundle.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const repoDir = path.resolve(desktopDir, '..');
const require = createRequire(import.meta.url);

const serverDistEntry = path.join(repoDir, 'server', 'dist', 'index.js');
const serverPublic = path.join(repoDir, 'server', 'public');
if (!existsSync(serverDistEntry) || !existsSync(serverPublic)) {
  console.error(
    '\n[desktop] Missing server/dist or server/public.\n' +
      '          Run `npm run build` at the repo root first.\n',
  );
  process.exit(1);
}

// 1) Electron main + preload -> dist/  (electron + node builtins stay external)
rmSync(path.join(desktopDir, 'dist'), { recursive: true, force: true });
await build({
  entryPoints: [path.join(desktopDir, 'src', 'main.ts'), path.join(desktopDir, 'src', 'preload.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['electron'],
  outdir: path.join(desktopDir, 'dist'),
  logLevel: 'info',
});

// 2) Server -> single ESM bundle. fsevents is an optional native dep of chokidar;
//    keep it external (chokidar swallows the require failure and falls back).
const genServer = path.join(desktopDir, '.gen', 'server');
const serverBundle = path.join(genServer, 'dist', 'index.mjs');
rmSync(genServer, { recursive: true, force: true });
mkdirSync(path.join(genServer, 'dist'), { recursive: true });
await build({
  entryPoints: [serverDistEntry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: ['fsevents'],
  // jsonc-parser's UMD main passes require into a factory, hiding its relative
  // dependencies from esbuild. Its ESM entry includes the required implementation
  // in this standalone bundle without changing resolution for other packages.
  alias: { 'jsonc-parser': require.resolve('jsonc-parser/lib/esm/main.js') },
  outfile: serverBundle,
  // Some bundled CJS deps call require() dynamically; provide it under ESM.
  banner: { js: "import{createRequire as ___cr}from'module';const require=___cr(import.meta.url);" },
  logLevel: 'info',
});
checkServerBundle(serverBundle);

// 3) The built SPA. The server resolves its public dir as `<__dirname>/../public`,
//    so it must sit at .gen/server/public (sibling of dist/).
cpSync(serverPublic, path.join(genServer, 'public'), { recursive: true });

console.log('[desktop] build complete → dist/ + .gen/server/');
