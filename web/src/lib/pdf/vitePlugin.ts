import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { Plugin } from 'vite';

const require = createRequire(import.meta.url);
const packageRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
const prefix = '/pdfjs-assets/';
export async function pdfAssetFiles() {
  const files = new Map<string, string>();
  for (const directory of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
    for (const entry of await fs.readdir(path.join(packageRoot, directory), { withFileTypes: true })) {
      if (!entry.isFile() || entry.name.startsWith('quickjs')) continue;
      if (!/\.(bcmap|pfb|ttf|otf|woff2?|wasm|icc|js)$/.test(entry.name) && !entry.name.startsWith('LICENSE')) continue;
      files.set(directory + '/' + entry.name, path.join(packageRoot, directory, entry.name));
    }
  }
  return files;
}

export function pdfAssetsPlugin(): Plugin {
  return {
    name: 'webobsidian-pdf-assets',
    async configureServer(server) {
      const files = await pdfAssetFiles();
      server.middlewares.use(async (request, response, next) => {
        const pathname = (request.url ?? '').split('?')[0];
        if (!pathname.startsWith(prefix)) return next();
        const file = files.get(pathname.slice(prefix.length));
        if (!file) { response.statusCode = 404; response.end('PDF resource not found'); return; }
        try {
          const bytes = await fs.readFile(file);
          response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream');
          response.setHeader('Content-Length', bytes.length);
          response.end(bytes);
        } catch (error) { next(error); }
      });
    },
    async generateBundle() {
      for (const [name, source] of await pdfAssetFiles())
        this.emitFile({ type: 'asset', fileName: prefix.slice(1) + name, source: await fs.readFile(source) });
    },
  };
}
