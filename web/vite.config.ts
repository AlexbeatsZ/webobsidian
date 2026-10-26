import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { mathJaxAssets, mathJaxVersion } from './mathjaxAssets';
import { pdfAssetsPlugin } from './src/lib/pdf/vitePlugin';

// Web build outputs to ../server/public so the server can serve the SPA.
export default defineConfig({
  plugins: [react(), mathJaxAssets(), pdfAssetsPlugin()],
  define: { __MATHJAX_VERSION__: JSON.stringify(mathJaxVersion),
    __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync(resolve(__dirname, '../desktop/package.json'), 'utf8')).version) },
  build: {
    manifest: true,
    outDir: '../server/public',
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      input: { index: resolve(__dirname, 'index.html') },
      output: {
        manualChunks: {
          codemirror: [
            '@codemirror/state',
            '@codemirror/view',
            '@codemirror/commands',
            '@codemirror/language',
            '@codemirror/lang-markdown',
            '@codemirror/theme-one-dark',
          ],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
  },
});
