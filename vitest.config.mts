import { defineConfig } from 'vitest/config';
import { MATHJAX_PACKAGE_VERSION } from './packages/markdown-core/src/mathPackages';

export default defineConfig({
  define: { __MATHJAX_VERSION__: JSON.stringify(MATHJAX_PACKAGE_VERSION) },
  test: {
    include: ['packages/**/*.test.ts', 'web/src/**/*.test.ts', 'server/src/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
  },
});
