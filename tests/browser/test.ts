import { test as base, expect } from '@playwright/test';

export const test = base.extend<{ runtimeErrors: void }>({
  runtimeErrors: [async ({ page }, use) => {
    // Vite's test page has no icon; fulfill the browser's implicit icon request.
    await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
    await page.route('**/api/writing', route => route.fulfill({ json: {
      version: 1, migration: 'fixture', latex: { snippets: '[]', snippetVariables: '{}' }, linter: {}, hotkeys: {},
    } }));
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text() + ' ' + message.location().url); });
    await use();
    expect(errors, 'No silent renderer/plugin failures').toEqual([]);
  }, { auto: true }],
});
export { expect };
