import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'web/src/**/*.test.ts', 'server/src/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
  },
});
