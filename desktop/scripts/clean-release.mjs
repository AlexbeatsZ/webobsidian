import { existsSync, lstatSync, realpathSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// All packaging entry points replace the previous local release, including
// version subdirectories and electron-builder's unpacked/intermediate files.
const desktopDir = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
const releaseDir = path.join(desktopDir, 'release');
if (existsSync(releaseDir)) {
  if (lstatSync(releaseDir).isSymbolicLink() || realpathSync(releaseDir) !== releaseDir) {
    throw new Error(`Refusing to clean a redirected release directory: ${releaseDir}`);
  }
  rmSync(releaseDir, { recursive: true, force: true });
}
console.log(`[desktop] removed old release artifacts: ${releaseDir}`);
