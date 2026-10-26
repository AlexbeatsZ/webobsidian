import { test, expect } from './test';

test.beforeEach(async ({ page }) => {
  await page.goto('/__render-test');
  await page.waitForFunction(() => !!window.renderHarness);
});

test('commands create a stable heading identity and reuse it for an embed', async ({ page }) => {
  await page.evaluate(() => window.renderHarness.reset('# Same\n\nbody\n\n# Same\n\nother'));
  await expect(page.locator('[data-slot="0"] .cm-content')).toContainText('body');
  const links = await page.evaluate(async () => {
    const copied: string[] = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { copied.push(value); } } });
    const modulePath = '/src/lib/contentReferenceCommands.ts';
    const { contentReferenceCommands } = await import(modulePath);
    window.renderHarness.cursor(0, 3); window.renderHarness.focus(0);
    await contentReferenceCommands.find((command: { id: string }) => command.id === 'content-reference:copy').run();
    await contentReferenceCommands.find((command: { id: string }) => command.id === 'content-reference:copy-embed').run();
    return copied;
  });
  expect(links[0]).toMatch(/^\[\[\^heading-[a-f\d]+\]\]$/);
  expect(links[1]).toBe('!' + links[0]);
  const raw = await page.evaluate(() => window.renderHarness.source(0));
  expect(raw.match(/\^heading-/g)).toHaveLength(1);
  expect(raw).toContain('\n\n# Same\n\nother');
  await page.evaluate(() => window.renderHarness.undo(0));
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe('# Same\n\nbody\n\n# Same\n\nother');
});

test('range command wraps complete selected blocks without changing their content', async ({ page }) => {
  const source = 'first paragraph\n\nsecond paragraph';
  await page.evaluate(source => window.renderHarness.reset(source), source);
  await expect(page.locator('[data-slot="0"] .cm-content')).toContainText('second paragraph');
  await page.evaluate(async source => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => {} } });
    const modulePath = '/src/lib/contentReferenceCommands.ts';
    const { contentReferenceCommands } = await import(modulePath);
    window.renderHarness.cursor(0, 0, source.length); window.renderHarness.focus(0);
    await contentReferenceCommands.find((command: { id: string }) => command.id === 'content-reference:range').run();
  }, source);
  const raw = await page.evaluate(() => window.renderHarness.source(0));
  expect(raw).toMatch(/^\^range-[a-f\d]+:start\n/);
  expect(raw).toContain(source);
  expect(raw).toMatch(/\^range-[a-f\d]+:end$/);
});

test('missing global targets never create a phantom note', async ({ page }) => {
  await page.route('**/api/resolve?**', route => route.fulfill({ json: { path: null, status: 'missing', targetOccurrences: [] } }));
  const result = await page.evaluate(async () => {
    const modulePath = '/src/lib/store.ts';
    const { useStore } = await import(modulePath);
    const created: string[] = [], messages: string[] = [];
    useStore.setState({ createNote: async (path: string) => { created.push(path); }, notify: (message: string) => messages.push(message) });
    for (const target of ['^heading-missing', '^heading-', '^heading-bad_id']) await useStore.getState().openWikilink(target, 'source.md');
    return { created, messages };
  });
  expect(result.created).toEqual([]);
  expect(result.messages).toEqual(['未找到引用目标：^heading-missing', '未找到引用目标：^heading-', '未找到引用目标：^heading-bad_id']);
});

test('global completion inserts an ID while displaying the title and file', async ({ page }) => {
  await page.route('**/api/content-targets?**', route => route.fulfill({ json: { targets: [{ id: 'heading-one', kind: 'heading', label: 'Readable heading', path: 'note.md' }] } }));
  await page.route('**/api/resolve?**', route => route.fulfill({ json: { path: 'note.md', status: 'resolved', targetOccurrences: [{ path: 'note.md', valid: true }] } }));
  await page.evaluate(() => window.renderHarness.reset('end\n\n'));
  await expect(page.locator('[data-slot="0"] .cm-content')).toContainText('end');
  await page.evaluate(() => { window.renderHarness.cursor(0, 5); window.renderHarness.focus(0); });
  await page.keyboard.type('[[^heading');
  await expect(page.locator('.suggestion-title')).toHaveText('Readable heading');
  await expect(page.locator('.suggestion-note')).toContainText('note.md');
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.renderHarness.source(0))).toContain('[[^heading-one]]');
});
