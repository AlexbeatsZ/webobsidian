import { test, expect } from './test';
import path from 'node:path';

test('equivalent React contexts retain CM derivations and fragment callbacks use current services', async ({ page }) => {
  await page.goto('/__render-test');
  await page.waitForFunction(() => !!window.renderHarness);
  const moduleUrl = '/@fs/' + path.resolve('tests/browser/performanceFixture.tsx').replaceAll('\\', '/');
  const result = await page.evaluate(async moduleUrl => {
    const fixture = await import(/* @vite-ignore */ moduleUrl);
    return fixture.verifyContextReconfiguration();
  }, moduleUrl);
  expect(result).toEqual({ layoutRetained: true, syntaxRetained: true, blocksRetained: true,
    mountRetained: true, changedServicesInvalidate: true, fallbackUsesLatestContext: true });
});
