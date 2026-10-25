import { test, expect } from './test';
import type { Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

let engine: import('../../server/src/services/search').QmdEngine;
let fixtureRoot: string;
test.beforeAll(async () => {
  const parent = path.join(os.tmpdir(), '.agents');
  await fs.mkdir(parent, { recursive: true });
  fixtureRoot = await fs.mkdtemp(path.join(parent, 'feedback-code-query-'));
  process.env.DATA_DIR = path.join(fixtureRoot, 'data');
  process.env.VAULT_PATH = path.join(fixtureRoot, 'vault');
  await fs.mkdir(process.env.VAULT_PATH, { recursive: true });
  const { QmdEngine } = await import('../../server/src/services/search');
  const { VaultCatalog } = await import('../../server/src/services/catalog');
  const { parseNote } = await import('../../server/src/services/markdown');
  const { updateSettings } = await import('../../server/src/services/settings');
  await updateSettings(settings => { settings.search.fuzzy = 0; settings.search.prefix = false; });
  engine = new QmdEngine(new VaultCatalog());
  for (const [name, source] of Object.entries({
    'Chemistry.md': '---\ntags: [chemistry]\n---\n# Chemistry\n\natom bond',
    'Nested.md': '---\ntags: [chemistry/physical]\n---\n# Nested\n\natom orbital',
    'Old.md': '---\ntags: [chemistry, old]\n---\n# Old\n\natom legacy',
    'Physics.md': '---\ntags: [physics]\n---\n# Physics\n\nwave',
    '目录/sub_dir/file-name.md': '# Path fixture\n\npath punctuation fixture',
  })) {
    await fs.mkdir(path.dirname(path.join(process.env.VAULT_PATH, name)), { recursive: true });
    await fs.writeFile(path.join(process.env.VAULT_PATH, name), source);
    engine.upsertNote(name, parseNote(name, source));
  }
  engine.finish();
});

test.afterAll(async () => {
  if (fixtureRoot && path.dirname(fixtureRoot) === path.join(os.tmpdir(), '.agents') && path.basename(fixtureRoot).startsWith('feedback-code-query-'))
    await fs.rm(fixtureRoot, { recursive: true, force: true });
});

async function reset(page: Page, source: string) {
  await page.evaluate(source => window.renderHarness.reset(source), source);
  await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe(source);
  await page.evaluate(() => {
    window.renderHarness.cursor(0, window.renderHarness.source(0).replace(/\r\n/g, '\n').replace(/^\uFEFF/, '').length);
    window.renderHarness.focus(0);
  });
}

async function privateContexts(page: Page) {
  await page.evaluate(async () => {
    const { installQueryBlocks } = await import('/src/lib/queryBlock.ts');
    (window as any).stopQueryBlocks ??= installQueryBlocks();
    const { EditorView } = await import('/node_modules/.vite/deps/@codemirror_view.js');
    const { Prec, StateEffect } = await import('/node_modules/.vite/deps/@codemirror_state.js');
    const { renderContext } = await import('/src/lib/renderContext.ts');
    const { createVaultRenderContext } = await import('/src/lib/vaultRenderContext.ts');
    for (const element of document.querySelectorAll('.cm-editor')) {
      const view = EditorView.findFromDOM(element)!;
      const previous = view.state.facet(renderContext);
      const context = createVaultRenderContext(previous.sourcePath, previous);
      view.dispatch({ effects: StateEffect.appendConfig.of(Prec.highest(renderContext.of(context))) });
    }
  });
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/vault-identity' || pathname === '/api/writing') return route.fallback();
    return route.fulfill({ status: 501, json: { error: `Unmocked isolated fixture request: ${pathname}` } });
  });
  await page.route('**/api/search?*', async route => {
    const params = new URL(route.request().url()).searchParams;
    const query = params.get('q') ?? '';
    await route.fulfill({ json: { hits: await engine.search(query, Number(params.get('limit') ?? 0)) } });
  });
  await page.goto('/__render-test');
  await page.waitForFunction(() => Boolean(window.renderHarness));
});

test('F01 keyboard selection exposes the exact opening and closing fences', async ({ page }) => {
  const source = 'Before\n\n```query\ntag:#chemistry\n```\n\nAfter';
  await reset(page, source);
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Control+Shift+End');
  const content = page.locator('[data-slot="0"] .cm-content');
  await expect(content).toContainText('```query');
  await expect(content).toContainText('```');
  expect(await page.evaluate(() => window.getSelection()?.toString())).toContain('```query');
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
});

test('F01 mouse enters the opening fence and native Shift+End selects its raw info', async ({ page }) => {
  const source = 'Before\n\n```query\ntag:#chemistry\n```\n\nAfter';
  await reset(page, source);
  const opening = page.locator('[data-slot="0"] .HyperMD-codeblock-begin');
  await opening.click({ position: { x: 20, y: 12 } });
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await expect(opening).toContainText('```query');
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('```query');
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
});

test('F01 native query is rendered in reading mode without loading a plugin', async ({ page }) => {
  await reset(page, 'Before\n\n```query\ntag:#chemistry\n```\n\nAfter');
  await privateContexts(page);
  await expect(page.locator('[data-slot="1"] .block-language-query')).toContainText('Chemistry');
});

for (const count of [100, 101, 150]) {
  test(`F01 bounded query requests 101 and displays at most 100 for ${count} returned hits`, async ({ page }, testInfo) => {
    const limits: string[] = [];
    const hits = Array.from({ length: count }, (_unused, index) => ({
      path: `Result${index + 1}.md`, title: `Result ${index + 1}`, snippet: `Snippet ${index + 1}`, score: 1, tags: [],
    }));
    await page.route('**/api/search?*', route => {
      limits.push(new URL(route.request().url()).searchParams.get('limit') ?? 'omitted');
      return route.fulfill({ json: { hits } });
    });
    const source = 'Before\n\n```query\n#chemistry\n```\n\nAfter';
    await reset(page, source);
    await privateContexts(page);
    await expect(page.locator('[data-slot="1"] .block-language-query li')).toHaveCount(100);
    expect(limits).toEqual(['101', '101']);
    for (const slot of [0, 1]) {
      const output = page.locator(`[data-slot="${slot}"] .block-language-query`);
      await expect(output.locator('li')).toHaveCount(100);
      await expect(output.locator('a')).toHaveCount(100);
      await expect(output.locator('li > div')).toHaveCount(100);
      await expect(output.locator('a').last()).toHaveText('Result 100');
      await expect(output.locator('[role="status"]')).toHaveText(count > 100
        ? '已显示前 100 个结果；还有更多匹配，请缩小搜索范围'
        : '100 个结果');
    }
    expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
    if (count === 150) await page.screenshot({ path: testInfo.outputPath('query-truncated.png') });
  });
}

for (const [name, source, opening, closing] of [
  ['root', 'Before\n\n```txt extra info\nbody\n```\n\nAfter', '```txt extra info', '```'],
  ['tilde', 'Before\n\n~~~~txt\nbody\n~~~~\n\nAfter', '~~~~txt', '~~~~'],
  ['quote', 'Before\n\n> ```txt\n> body\n> ```\n\nAfter', '> ```txt', '> ```'],
  ['list', 'Before\n\n- item\n\n  ```txt\n  body\n  ```\n\nAfter', '  ```txt', '  ```'],
  ['quote-list', 'Before\n\n> - item\n>\n>   ```txt\n>   body\n>   ```\n\nAfter', '>   ```txt', '>   ```'],
  ['same-line-list', 'Before\n\n- ```txt\n  body\n  ```\n\nAfter', '- ```txt', '  ```'],
]) {
  test(`F01 ${name} opening and closing support mouse drag and keyboard selection`, async ({ page }, testInfo) => {
    await reset(page, source);
    const content = page.locator('[data-slot="0"] .cm-content');
    for (const [selector, expected] of [['.HyperMD-codeblock-begin', opening], ['.HyperMD-codeblock-end', closing]]) {
      const line = content.locator(selector);
      await expect(line).toContainText(expected.match(/[`~].*/)?.[0] ?? expected);
      const box = await line.boundingBox();
      expect(box).not.toBeNull();
      await page.mouse.move(box!.x + 2, box!.y + box!.height / 2);
      await page.mouse.down();
      await page.mouse.move(box!.x + box!.width - 4, box!.y + box!.height / 2, { steps: 12 });
      await page.mouse.up();
      expect(await page.evaluate(() => window.getSelection()?.toString())).toContain(expected.match(/[`~].*/)?.[0]);
      await line.click({ position: { x: 20, y: box!.height / 2 } });
      await page.keyboard.press('Home');
      await page.keyboard.press('Home');
      await page.keyboard.press('Shift+End');
      expect(await page.evaluate(() => window.getSelection()?.toString())).toContain(expected.match(/[`~].*/)?.[0]);
    }
    expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
    if (name === 'quote-list') await page.screenshot({ path: testInfo.outputPath('nested-fences.png') });
  });
}

test('F01 fence edits and undo preserve BOM mixed line endings and unrelated bytes', async ({ page }) => {
  const source = '\uFEFFBefore  \r\n\r\n```query\r\n#chemistry\n```\r\n\r\nAfter 😀';
  await reset(page, source);
  const opening = page.locator('[data-slot="0"] .HyperMD-codeblock-begin');
  await opening.click();
  await page.keyboard.press('End');
  for (let count = 0; count < 5; count++) await page.keyboard.press('Shift+ArrowLeft');
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('query');
  await page.keyboard.type('text');
  await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe(source.replace('```query', '```text'));
  await page.evaluate(() => window.renderHarness.save(0));
  expect(await page.evaluate(() => window.renderHarness.writes)).toEqual([source.replace('```query', '```text')]);
  await page.keyboard.press('Control+z');
  await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe(source);
  await page.evaluate(() => window.renderHarness.save(0));
  expect(await page.evaluate(() => window.renderHarness.writes)).toEqual([source.replace('```query', '```text'), source]);
});

test('F01 reading keeps fences concealed and cannot change source through keys or dispatch', async ({ page }) => {
  const source = '> ```text\n> body\n> ```\n\nAfter';
  await reset(page, source);
  const reading = page.locator('[data-slot="1"]');
  await expect(reading.locator('.cm-content')).not.toContainText('```');
  await page.evaluate(() => {
    (document.activeElement as HTMLElement)?.blur();
    window.renderHarness.focus(1);
    window.renderHarness.cursor(1, 0);
    window.renderHarness.edit(1, [{ from: 0, insert: 'FORBIDDEN' }]);
  });
  await reading.locator('.cm-content').click();
  await page.keyboard.type('FORBIDDEN');
  await page.keyboard.press('Backspace');
  await expect(reading.locator('.cm-source-toggle')).toHaveCount(0);
  expect(await page.evaluate(() => window.renderHarness.source(1))).toBe(source);
});

for (const [query, expected] of [
  ['tag:#chemistry -tag:#old', ['Chemistry', 'Nested']],
  ['atom #chemistry -#old', ['Chemistry', 'Nested']],
  ['path:Chemistry', ['Chemistry']],
  ['#chemistry/physical', ['Nested']],
  ['#missing', []],
] as const) {
  test(`F01 native query reuses QmdEngine for ${query}`, async ({ page }, testInfo) => {
    const source = `Before\n\n\x60\x60\x60query\n${query}\n\x60\x60\x60\n\nAfter`;
    await reset(page, source);
    await privateContexts(page);
    const reading = page.locator('[data-slot="1"] .block-language-query');
    await expect(reading.locator('[role="status"]')).toHaveText(expected.length ? `${expected.length} 个结果` : '没有搜索结果');
    await expect(reading.locator('a')).toHaveText([...expected]);
    expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
    if (query.startsWith('tag:')) {
      await reading.getByRole('link', { name: 'Chemistry', exact: true }).click();
      expect(await page.evaluate(() => window.renderHarness.links)).toContain('1:Chemistry.md');
      await page.screenshot({ path: testInfo.outputPath('query-results.png') });
    }
  });
}

test('F01 query source entry supports selection editing Escape and readonly boundaries', async ({ page }, testInfo) => {
  const source = 'Before\n\n```query\n#chemistry\n```\n\nAfter';
  await reset(page, source);
  await privateContexts(page);
  const live = page.locator('[data-slot="0"]');
  await expect(live.locator('.block-language-query')).toContainText('3 个结果');
  await live.getByRole('button', { name: '编辑代码块源码' }).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('```query');
  await expect(live.locator('.block-language-query')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('query-source.png') });
  await page.keyboard.press('Escape');
  await expect(live.locator('.block-language-query')).toContainText('3 个结果');
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Control+Shift+End');
  await expect(live.locator('.cm-content')).toContainText('```query');
  expect(await page.evaluate(() => window.getSelection()?.toString())).toContain('```query');
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
  await expect(page.locator('[data-slot="1"] .cm-source-toggle')).toHaveCount(0);
});

for (const query of ['embed OR search', 'atom bond', '"atom bond"', 'line:atom', 'file:Chemistry', '/atom/', '/atom/i', '[status:Draft]', 'tag:(chemistry OR physics)', '-atom', 'path:/atom/i']) {
  test(`F01 unsupported query is explicit and makes no search request: ${query}`, async ({ page }) => {
    let requests = 0;
    await page.route('**/api/search?*', route => { requests++; return route.fulfill({ json: { hits: [] } }); });
    await reset(page, `Before\n\n\x60\x60\x60query\n${query}\n\x60\x60\x60\n\nAfter`);
    await privateContexts(page);
    await expect(page.locator('[data-slot="1"] .block-language-query')).toContainText('此 query 表达式暂不支持');
    expect(requests).toBe(0);
  });
}

for (const prefix of ['> ', '  ', '>   ']) {
  test(`F01 native query in quote/list prefix ${JSON.stringify(prefix)} preserves original source`, async ({ page }) => {
    const head = prefix === '> ' ? 'Before\n\n' : prefix === '  ' ? 'Before\n\n- item\n\n' : 'Before\n\n> - item\n>\n';
    const source = `${head}${prefix}\x60\x60\x60query\n${prefix}#chemistry -#old\n${prefix}\x60\x60\x60\n\nAfter`;
    await reset(page, source);
    await privateContexts(page);
    await expect(page.locator('[data-slot="1"] .block-language-query')).toContainText('2 个结果');
    expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
  });
}

test('F01 unfinished query remains source and never searches', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/search?*', route => { requests++; return route.fulfill({ json: { hits: [] } }); });
  await reset(page, 'Before\n\n```query\n#chemistry\nunfinished');
  await privateContexts(page);
  await expect(page.locator('.block-language-query')).toHaveCount(0);
  expect(requests).toBe(0);
});

test('F01 path punctuation reuses the existing API with its limited matching semantics disclosed', async ({ page }) => {
  const query = 'path:目录/sub_dir/file-name.md';
  const expected = await engine.search(query);
  expect(expected.map(hit => hit.path)).toContain('目录/sub_dir/file-name.md');
  const observed: string[] = [];
  await page.route('**/api/search?*', async route => {
    const requestQuery = new URL(route.request().url()).searchParams.get('q') ?? '';
    observed.push(requestQuery);
    await route.fulfill({ json: { hits: await engine.search(requestQuery) } });
  });
  await reset(page, `Before\n\n\x60\x60\x60query\n${query}\n\x60\x60\x60\n\nAfter`);
  await privateContexts(page);
  const output = page.locator('[data-slot="1"] .block-language-query');
  await expect(output.locator('a')).toHaveText(expected.map(hit => hit.title));
  await expect(output).toContainText('尚不支持 Obsidian 的完整路径匹配语义');
  expect(observed).toEqual([query, query]);
});

test('F01 all registered code processors reveal intersecting selections and honor closed option', async ({ page }) => {
  await page.evaluate(async () => {
    const { Component } = await import('/src/lib/obsidian/events.ts');
    const { registerCodeProcessor } = await import('/src/lib/obsidian/markdown.ts');
    const owner = new Component();
    registerCodeProcessor(owner, 'selection-fixture', (_source, element) => { element.textContent = 'FIXTURE OUTPUT'; }, 0, { requiresClosed: true });
  });
  await reset(page, 'Before\n\n```selection-fixture\nbody\n```\n\nAfter');
  await privateContexts(page);
  await expect(page.locator('[data-slot="0"] .block-language-selection-fixture')).toHaveCount(1);
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Control+Shift+End');
  await expect(page.locator('[data-slot="0"] .block-language-selection-fixture')).toHaveCount(0);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toContain('```selection-fixture');
  await expect(page.locator('[data-slot="1"] .block-language-selection-fixture')).toHaveCount(1);
  await reset(page, 'Before\n\n```selection-fixture\nbody');
  await privateContexts(page);
  await expect(page.locator('.block-language-selection-fixture')).toHaveCount(0);
});

test('F01 query aborts superseded search and drops late output after source entry', async ({ page }) => {
  const pending: import('@playwright/test').Route[] = [];
  await page.route('**/api/search?*', route => { pending.push(route); });
  await reset(page, 'Before\n\n```query\n#chemistry\n```\n\nAfter');
  await privateContexts(page);
  await expect.poll(() => pending.length).toBe(2);
  await page.locator('[data-slot="0"]').getByRole('button', { name: '编辑代码块源码' }).click();
  await page.evaluate(() => window.renderHarness.reset('Replacement document'));
  for (const route of pending) await route.fulfill({ json: { hits: [{ path: 'late.md', title: 'STALE RESULT', snippet: '', score: 1, tags: [] }] } }).catch(() => {});
  await expect(page.locator('.block-language-query')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('STALE RESULT');
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe('Replacement document');
});

test('F01 query result content is text and never executes note HTML or code', async ({ page }, testInfo) => {
  const payload = '<img src=x onerror="window.queryExecuted=true"><script>window.queryExecuted=true</script>```js\nwindow.queryExecuted=true';
  await page.route('**/api/search?*', route => route.fulfill({ json: { hits: [
    { path: 'javascript:window.queryExecuted=true', title: payload, snippet: payload, score: 1, tags: [] },
  ] } }));
  await reset(page, 'Before\n\n```query\n#chemistry\n```\n\nAfter');
  await privateContexts(page);
  const output = page.locator('[data-slot="1"] .block-language-query');
  await expect(output.locator('a')).toHaveText(payload);
  await expect(output.locator('li > div')).toHaveText(payload);
  await expect(output.locator('script,img,iframe,object,[onerror],.native-js-code-block')).toHaveCount(0);
  expect(await output.locator('a').evaluate(link => (link as HTMLAnchorElement).protocol)).toBe('http:');
  await output.locator('a').click();
  expect(await page.evaluate(() => (window as any).queryExecuted)).toBeUndefined();
  await page.screenshot({ path: testInfo.outputPath('query-safe-text.png') });
});

test.describe('F01 visible query request failure', () => {
  test.use({ expectedErrors: ['503'] });
  test('search failure remains visible and source entry is still usable', async ({ page }, testInfo) => {
    await page.route('**/api/search?*', route => route.fulfill({ status: 503, json: { error: 'fixture search unavailable' } }));
    const source = 'Before\n\n```query\n#chemistry\n```\n\nAfter';
    await reset(page, source);
    await privateContexts(page);
    await expect(page.locator('[data-slot="1"] .block-language-query')).toContainText('搜索失败：fixture search unavailable');
    await page.screenshot({ path: testInfo.outputPath('query-failure.png') });
    await page.locator('[data-slot="0"]').getByRole('button', { name: '编辑代码块源码' }).click();
    await expect(page.locator('[data-slot="0"] .cm-content')).toContainText('```query');
    expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
  });
});

test('F01 existing search notifications abort old requests and dispose removes the listener', async ({ page }) => {
  let requests = 0, aborted = 0;
  const pending: import('@playwright/test').Route[] = [];
  page.on('requestfailed', request => { if (request.url().includes('/api/search?')) aborted++; });
  await page.route('**/api/search?*', route => { requests++; pending.push(route); });
  await page.route(/\/api\/settings\/?$/, route => route.fulfill({ json: {} }));
  await reset(page, 'Before\n\n```query\n#chemistry\n```\n\nAfter');
  await privateContexts(page);
  await expect.poll(() => requests).toBe(2);
  await page.evaluate(async () => {
    const { updateSearch } = await import('/src/lib/search.ts');
    await updateSearch({ enabled: false });
  });
  await expect.poll(() => requests).toBe(4);
  await expect.poll(() => aborted).toBeGreaterThanOrEqual(2);
  await pending[2].fulfill({ json: { hits: [{ path: 'Current.md', title: 'CURRENT', snippet: '', score: 1, tags: [] }] } });
  await pending[3].fulfill({ json: { hits: [{ path: 'Current.md', title: 'CURRENT', snippet: '', score: 1, tags: [] }] } });
  await expect(page.locator('[data-slot="1"] .block-language-query')).toContainText('CURRENT');
  for (const route of pending.slice(0, 2)) await route.fulfill({ json: { hits: [{ path: 'Old.md', title: 'STALE', snippet: '', score: 1, tags: [] }] } }).catch(() => {});
  await expect(page.locator('body')).not.toContainText('STALE');
  await page.evaluate(() => window.renderHarness.reset('Disposed query'));
  await expect(page.locator('.block-language-query')).toHaveCount(0);
  await page.evaluate(async () => {
    const { updateSearch } = await import('/src/lib/search.ts');
    await updateSearch({ enabled: true });
  });
  expect(requests).toBe(4);
});
