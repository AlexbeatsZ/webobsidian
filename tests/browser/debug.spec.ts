import { test, expect } from './test';

test.describe('controlled plugin failure', () => {
test.use({ expectedErrors: ['controlled-plugin-fixture'] });
test('debug records progressive input, math source, view lifetime and errors across navigation', async ({ page }, info) => {
  const events: any[] = [];
  let ui = { debugRecording: false, debugSource: true };
  await page.route('**/api/settings/', async route => {
    if (route.request().method() === 'PUT') Object.assign(ui, route.request().postDataJSON().ui);
    await route.fulfill({ json: { ui } });
  });
  await page.route('**/api/settings/debug', async route => {
    if (route.request().method() === 'POST') events.push(...route.request().postDataJSON());
    if (route.request().method() === 'DELETE') events.length = 0;
    await route.fulfill({ json: route.request().method() === 'GET' ? { text: events.map(e => JSON.stringify(e) + '\n').join('') } : { ok: true } });
  });
  await page.goto('/__render-test?debug');
  await page.waitForFunction(() => Boolean(window.renderHarness));
  await page.evaluate(() => { window.renderHarness.reset(''); window.renderHarness.focus(0); });
  await page.keyboard.type('before');
  expect(events).toHaveLength(0);
  await page.getByRole('checkbox', { name: '开启调试记录' }).click();
  await expect(page.getByRole('checkbox', { name: '开启调试记录' })).toBeChecked();
  await page.evaluate(() => window.renderHarness.reset(''));
  await expect(page.locator('[data-slot="0"] .cm-content')).toHaveText('');
  await page.evaluate(() => window.renderHarness.focus(0));
  for (const ch of '> [!tip]') await page.keyboard.type(ch);
  await page.keyboard.press('Enter'); await page.keyboard.type('body $$x$$');
  await info.attach('debug-source', { body: await page.evaluate(() => window.renderHarness.source(0)), contentType: 'text/plain' });
  await page.getByRole('button', { name: '记录现场', exact: true }).click();
  await info.attach('debug-events', { body: JSON.stringify(events), contentType: 'application/json' });
  await expect(page.locator('[data-slot="0"] .cm-callout-head')).toContainText('Tip');
  await page.evaluate(() => window.renderHarness.cursor(0, window.renderHarness.source(0).length));
  await page.evaluate(() => window.renderHarness.cursor(0, 0));
  await expect(page.locator('[data-slot="0"] .cm-math-rendered')).toHaveCount(1);
  await page.locator('[data-slot="0"] button[aria-label*="公式"]').first().click();
  await expect(page.locator('[data-slot="0"] .cm-math-edit-preview')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.renderHarness.crashPlugin(0));
  await page.evaluate(() => window.dispatchEvent(new ErrorEvent('error', { error: new Error('controlled-debug-fixture') })));
  await page.getByRole('button', { name: '记录现场', exact: true }).click();
  await expect.poll(() => events.some(e => e.type === 'window.error')).toBe(true);
  expect(events.some(e => e.type === 'editor.transaction' && e.data.changes.length)).toBe(true);
  expect(events.some(e => e.type === 'editor.transaction' && e.data.source)).toBe(true);
  expect(events.some(e => e.type === 'editor.snapshot' && e.data.reason === 'manual')).toBe(true);
  expect(events.some(e => e.type === 'editor.destroy')).toBe(true);
  expect(events.some(e => e.type === 'math.request')).toBe(true);
  expect(events.some(e => e.type === 'editor.input' && e.data.event === 'keydown')).toBe(true);
  // A complete per-view baseline plus transaction patches reproduces actual input.
  const view = events.find(e => e.type === 'editor.transaction' && e.data.docChanged && !e.data.readonly).data.view;
  const first = events.findIndex(e => e.type === 'editor.snapshot' && e.data.document.text === '' && e.data.view === view);
  let source = '';
  for (const e of events.slice(first + 1)) if (e.type === 'editor.transaction' && e.data.view === view) {
    for (const change of [...e.data.changes].reverse()) source = source.slice(0, change.from) + change.inserted.text + source.slice(change.to);
  }
  expect(source).toBe('> [!tip]\n> body $$x$$');
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: '导出日志', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/^webobsidian-debug-.*\.jsonl$/);
  const count = events.length;
  await page.reload(); await page.waitForFunction(() => Boolean(window.renderHarness));
  await expect(page.getByRole('checkbox', { name: '开启调试记录' })).toBeChecked();
  await page.getByRole('button', { name: '记录现场', exact: true }).click();
  await expect.poll(() => events.length).toBeGreaterThan(count);
  expect(events.some(e => e.type === 'window.error' && e.data.message === 'controlled-debug-fixture')).toBe(true);
  expect(events.some(e => e.type === 'editor.exception' && e.data.message === 'controlled-plugin-fixture')).toBe(true);
  // Source-disabled logging retains ranges/timings without the entered text.
  await page.getByRole('checkbox', { name: '包含笔记源码' }).click();
  await expect(page.getByRole('checkbox', { name: '包含笔记源码' })).not.toBeChecked();
  await page.getByRole('button', { name: '记录现场', exact: true }).click();
  const afterOptions = events.length;
  await page.evaluate(() => window.renderHarness.reset(''));
  await expect(page.locator('[data-slot="0"] .cm-content')).toHaveText('');
  await page.evaluate(() => window.renderHarness.focus(0));
  await page.keyboard.type('PRIVATE-TEXT');
  await page.getByRole('button', { name: '记录现场', exact: true }).click();
  expect(JSON.stringify(events.slice(afterOptions))).not.toContain('PRIVATE');
  expect(events.slice(afterOptions).some(e => e.type === 'editor.transaction' && e.data.changes.some((c: any) => c.inserted.length > 0))).toBe(true);
  await page.getByRole('checkbox', { name: '开启调试记录' }).click();
  await expect(page.getByRole('checkbox', { name: '开启调试记录' })).not.toBeChecked();
  const stopped = events.length;
  await page.evaluate(() => window.renderHarness.focus(0)); await page.keyboard.type('OFF');
  await page.waitForTimeout(2100); expect(events).toHaveLength(stopped);
});
});

test('debug retains failed writes for export and supports clearing after stopping', async ({ page }) => {
  let enabled = false, fail = true;
  const events: any[] = [];
  await page.route('**/api/settings/', async route => {
    if (route.request().method() === 'PUT') enabled = route.request().postDataJSON().ui.debugRecording;
    await route.fulfill({ json: { ui: { debugRecording: enabled, debugSource: true } } });
  });
  await page.route('**/api/settings/debug', async route => {
    // A successful HTTP response with invalid JSON exercises the fetch error
    // path without suppressing genuine browser network errors in the fixture.
    if (fail) { await route.fulfill({ status: 200, contentType: 'application/json', body: 'invalid JSON' }); return; }
    if (route.request().method() === 'POST') events.push(...route.request().postDataJSON());
    if (route.request().method() === 'DELETE') events.length = 0;
    await route.fulfill({ json: route.request().method() === 'GET' ? { text: events.map(e => JSON.stringify(e) + '\n').join('') } : { ok: true } });
  });
  await page.goto('/__render-test?debug'); await page.waitForFunction(() => Boolean(window.renderHarness));
  await page.getByRole('checkbox', { name: '开启调试记录' }).click();
  await expect(page.getByRole('checkbox', { name: '开启调试记录' })).toBeChecked();
  await page.evaluate(() => window.renderHarness.focus(0)); await page.keyboard.type('record-before-write-error');
  await page.getByRole('button', { name: '记录现场', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('JSON');
  const promise = page.waitForEvent('download'); await page.getByRole('button', { name: '导出日志', exact: true }).click();
  const download = await promise, path = await download.path();
  const { readFile } = await import('node:fs/promises');
  const text = await readFile(path!, 'utf8');
  expect(text).toContain('record-before-write-error');
  expect(JSON.parse(text.split('\n')[0]).unsaved).toBeGreaterThan(0);
  fail = false;
  await page.getByRole('button', { name: '记录现场', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('checkbox', { name: '开启调试记录' }).click();
  await expect(page.getByRole('checkbox', { name: '开启调试记录' })).not.toBeChecked();
  expect(events.length).toBeGreaterThan(0);
  await page.getByRole('button', { name: '清空日志', exact: true }).click();
  await expect.poll(() => events.length).toBe(0);
});
