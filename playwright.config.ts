import { defineConfig } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';

const output = path.join(os.tmpdir(), '.agents', 'meta-obsidian-render-tests');
export default defineConfig({
  testDir: './tests/browser',
  outputDir: path.join(output, 'results'),
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5179', viewport: { width: 1480, height: 780 },
    launchOptions: { executablePath: process.env.RENDER_TEST_BROWSER },
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'render', testMatch: /(?:render|quote-origin|elements|math-inline)\.spec\.ts/ },
    { name: 'integration', testMatch: /integration\.spec\.ts/ },
    { name: 'plugins', testMatch: /plugins\.spec\.ts/ },
    { name: 'workspace', testMatch: /sidebar\.spec\.ts/ },
    { name: 'palette', testMatch: /palette\.spec\.ts/ },
  ],
  webServer: {
    command: 'npm run build:core && npm --workspace web run dev -- --host 127.0.0.1 --port 5179 --strictPort',
    url: 'http://127.0.0.1:5179/__render-test',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
