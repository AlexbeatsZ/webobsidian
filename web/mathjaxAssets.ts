import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Plugin } from 'vite';

const require = createRequire(import.meta.url);
const root = dirname(require.resolve('mathjax/package.json'));
const fontRoot = dirname(createRequire(join(root, 'package.json')).resolve('@mathjax/mathjax-newcm-font/package.json'));
export const mathJaxVersion: string = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

/** Keep component-relative URLs intact for MathJax's extension/font loader. */
export function mathJaxAssets(): Plugin {
  const prefix = `assets/mathjax-${mathJaxVersion}/`;
  const assets = new Map<string, string>([
    ['startup.js', join(root, 'startup.js')],
    ['core.js', join(root, 'core.js')],
    ['input/tex.js', join(root, 'input/tex.js')],
    ['output/svg.js', join(root, 'output/svg.js')],
    ['fonts/mathjax-newcm/svg.js', join(fontRoot, 'svg.js')],
    ['ui/safe.js', join(root, 'ui/safe.js')],
    ['LICENSE', join(root, 'LICENSE')],
  ]);
  for (const extension of ['bbm', 'bboldx', 'dsfont', 'mhchem']) {
    const name = `mathjax-${extension}-font-extension`;
    const directory = dirname(require.resolve(`@mathjax/${name}/package.json`));
    assets.set(`fonts/${name}/svg.js`, join(directory, 'svg.js'));
  }
  for (const [directory, target] of [
    [join(root, 'input/tex/extensions'), 'input/tex/extensions'],
    [join(fontRoot, 'svg/dynamic'), 'fonts/mathjax-newcm/svg/dynamic'],
  ]) {
    for (const file of readdirSync(directory)) {
      if (file.endsWith('.js')) assets.set(`${target}/${file}`, join(directory, file));
    }
  }
  return {
    name: 'local-mathjax-assets',
    configureServer(server) {
      server.middlewares.use(`${server.config.base}${prefix}`, (req, res, next) => {
        const file = assets.get((req.url ?? '').split('?')[0].replace(/^\//, ''));
        if (!file) return next();
        res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/plain; charset=utf-8');
        res.end(readFileSync(file));
      });
    },
    generateBundle() {
      for (const [name, file] of assets) {
        this.emitFile({ type: 'asset', fileName: prefix + name, source: readFileSync(file) });
      }
    },
  };
}
