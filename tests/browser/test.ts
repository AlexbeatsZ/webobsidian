import { test as base, expect } from '@playwright/test';

export const test = base.extend<{ runtimeErrors: void; expectedErrors: string[] }>({
  expectedErrors: [[], { option: true }],
  runtimeErrors: [async ({ page, expectedErrors }, use) => {
    // Vite's test page has no icon; fulfill the browser's implicit icon request.
    await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
    await page.route('**/api/vault-identity', route => route.fulfill({ json: { vault: 'browser-fixture' } }));
    await page.route('**/api/writing', route => route.fulfill({ json: {
      version: 1, migration: 'fixture', latex: { snippets: '[]', snippetVariables: '{}' }, linter: {}, hotkeys: {},
    } }));
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text() + ' ' + message.location().url); });
    await use();
    for (const message of expectedErrors) expect(errors.some(error => error.includes(message)), 'Expected controlled failure: ' + message).toBe(true);
    expect(errors.filter(error => !expectedErrors.some(message => error.includes(message))), 'No silent renderer/plugin failures').toEqual([]);
  }, { auto: true }],
});
export { expect };
