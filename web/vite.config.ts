import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { mathJaxAssets, mathJaxVersion } from './mathjaxAssets';

// Web build outputs to ../server/public so the server can serve the SPA.
export default defineConfig({
  plugins: [react(), mathJaxAssets()],
  define: { __MATHJAX_VERSION__: JSON.stringify(mathJaxVersion) },
  build: {
    manifest: true,
    outDir: '../server/public',
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      input: { index: resolve(__dirname, 'index.html'), share: resolve(__dirname, 'src/share.ts') },
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
      '/auth': 'http://localhost:8787',
      '/public': 'http://localhost:8787',
      '/share': 'http://localhost:8787', // SSR share page is server-rendered even in dev
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
  },
});
