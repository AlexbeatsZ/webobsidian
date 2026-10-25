import { defineConfig } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';

const port = Number(process.env.RENDER_TEST_PORT ?? 5179);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('RENDER_TEST_PORT must be an integer from 1 to 65535');
const baseURL = `http://127.0.0.1:${port}`;
const output = process.env.RENDER_TEST_OUTPUT_DIR
  ? path.resolve(process.env.RENDER_TEST_OUTPUT_DIR)
  : path.join(os.tmpdir(), '.agents', `meta-obsidian-render-tests-${Date.now()}-${process.pid}`);
export default defineConfig({
  testDir: './tests/browser',
  outputDir: path.join(output, 'results'),
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL, viewport: { width: 1480, height: 780 },
    launchOptions: { executablePath: process.env.RENDER_TEST_BROWSER },
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'render', testMatch: /\.spec\.ts$/, testIgnore: /(?:integration|plugins|sidebar|palette)\.spec\.ts$/ },
    { name: 'integration', testMatch: /integration\.spec\.ts/ },
    { name: 'plugins', testMatch: /plugins\.spec\.ts/ },
    { name: 'workspace', testMatch: /sidebar\.spec\.ts/ },
    { name: 'palette', testMatch: /palette\.spec\.ts/ },
  ],
  webServer: {
    command: `${process.env.RENDER_TEST_SKIP_CORE_BUILD === '1' ? '' : 'npm run build:core && '}npm --workspace web run dev -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: `${baseURL}/__render-test`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
