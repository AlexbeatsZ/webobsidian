import { test as base, expect } from './test';
import type { Locator, Page, Route } from '@playwright/test';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function runPageCommand(page: Page, id: string) {
  await page.evaluate(async id => {
    const module = '/src/lib/plugins.ts';
    await (await import(module)).sharedApp.commands.execute(id);
  }, id);
}

const richParitySource = [
  '---', 'status: parity', 'tags: [layout, shared]', '---', '',
  '# Visible H1 heading', '', 'Parity body 中文 Text123', '', '## Visible H2 heading', '',
  '> Plain blockquote', '', '> [!note] Shared callout', '> Callout body text.', '',
  '| Column A | Column B |', '| --- | --- |', '| first | second |', '',
  'Inline formula $x^2+1$ continues here.', '', '$$', 'x^2+\\text{中文}=1', '$$', '',
  'Parity tail sentinel',
].join('\n');
const original = {
  'main.md': '# Main\n\nMain，body',
  'side.md': '# Side\n\nSide，body',
  'replacement.md': '# Replacement\n\nUntouched replacement',
  'parity-rich.md': richParitySource,
  'parity-blank.md': '',
};
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const documentStart = process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home';
const documentEnd = process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End';
type Pane = 'main' | 'split';
type Exit = 'close' | 'replace';
interface Backend { vault: string; data: string; url: string }

// Reuse the real-App entry and source-server isolation from appearance/file-defaults.
// Every API response (including identity and writing settings) comes from this Vault.
const test = base.extend<{ backend: Backend }>({
  backend: async ({ page }, use, info) => {
    test.setTimeout(60000);
    const temporary = path.join(os.tmpdir(), '.agents');
    await fs.mkdir(temporary, { recursive: true });
    const directory = await fs.mkdtemp(path.join(temporary, 'split-editing-browser-'));
    const vault = path.join(directory, 'vault'), data = path.join(directory, 'data');
    const configuration = path.join(vault, '.obsidian', 'webobsidian');
    await fs.mkdir(configuration, { recursive: true }); await fs.mkdir(data);
    for (const [file, text] of Object.entries(original)) await fs.writeFile(path.join(vault, file), text);
    await fs.writeFile(path.join(data, 'uistate.json'), JSON.stringify({ tabs: [{ path: 'main.md', title: 'main.md' }], activePath: 'main.md' }));
    // Formatting distinguishes an explicit Save from the registry's 900ms autosave.
    await fs.writeFile(path.join(configuration, 'writing.jsonc'), JSON.stringify({
      version: 1, migration: 'split-editing-fixture',
      latex: { loadSnippetsFromFile: false, loadSnippetVariablesFromFile: false, snippets: '[]', snippetVariables: '{}' },
      linter: { lintOnSave: true, customRegexes: [{ find: '，', replace: ',', flags: 'g', enabled: true }] },
      hotkeys: {},
    }));
    const child = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
      cwd: process.cwd(), windowsHide: true,
      env: { ...process.env, PORT: '0', HOST: '127.0.0.1', DATA_DIR: data, VAULT_PATH: vault,
        ALLOWED_ROOTS: directory, WEBOBSIDIAN_INITIAL_VAULT: '', NODE_ENV: 'development' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let logs = '', mounted = false;
    const requests = new Set<Promise<void>>();
    child.stdout!.on('data', chunk => { logs += chunk.toString(); });
    child.stderr!.on('data', chunk => { logs += chunk.toString(); });
    child.on('error', error => { logs += String(error); });
    const entry = '/@fs/' + path.resolve('tests/browser/appearanceFixture.tsx').replaceAll('\\', '/');
    try {
      const endpoint = path.join(data, 'operations-endpoint.json');
      let url = '';
      await expect.poll(async () => {
        if (child.exitCode !== null) throw new Error(logs);
        try {
          url = JSON.parse(await fs.readFile(endpoint, 'utf8')).url;
          return url;
        } catch (error) {
          // The endpoint file can be observed between creation and write completion.
          if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT') return '';
          throw error;
        }
      }, { timeout: 20000 }).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      const settings = await page.request.get(url + '/api/settings');
      expect(settings.ok()).toBe(true);
      expect(path.resolve((await settings.json()).vault.path)).toBe(path.resolve(vault));
      await page.route('**/api/**', route => {
        const task = (async () => {
          const requestUrl = new URL(route.request().url());
          const response = await route.fetch({ url: url + requestUrl.pathname + requestUrl.search });
          if (!page.isClosed()) await route.fulfill({ response });
        })();
        requests.add(task);
        return task.finally(() => requests.delete(task));
      });
      await page.routeWebSocket('**/ws', () => {});
      await page.routeWebSocket(url => url.searchParams.has('token'), socket => socket.send(JSON.stringify({ type: 'connected' })));
      await page.route('**/', async route => {
        if (route.request().resourceType() !== 'document') return route.fallback();
        const response = await route.fetch();
        await route.fulfill({ response, body: (await response.text()).replace('/src/main.tsx', entry) });
      });
      await page.goto('/');
      mounted = true;
      await expect(content(page, 'main')).toContainText('Main，body');
      await page.evaluate(async () => {
        const storePath = '/src/lib/store.ts', writingPath = '/src/lib/writing/config.ts';
        const { useStore } = await import(storePath);
        await (await import(writingPath)).ensureWriting();
        useStore.setState({ leftOpen: false, rightOpen: false });
      });
      await use({ vault, data, url });
    } finally {
      try {
        if (mounted && !page.isClosed()) await page.evaluate(async entry => {
          const storePath = '/src/lib/store.ts';
          const { flushWorkspaceState } = await import(storePath);
          await flushWorkspaceState();
          const { dispose } = await import(entry); dispose();
          await flushWorkspaceState();
        }, entry);
      } finally {
        // Only this fixture's page/process is closed, after draining real requests.
        await page.close();
        try { await Promise.all([...requests]); }
        finally {
          if (child.exitCode === null && child.pid) {
            const closed = new Promise<void>(resolve => child.once('close', () => resolve()));
            child.kill(); await closed;
          }
          await fs.mkdir(path.dirname(info.outputPath('server.log')), { recursive: true });
          await fs.writeFile(info.outputPath('server.log'), logs);
          const prefix = path.join(temporary, 'split-editing-browser-');
          if (!path.resolve(directory).startsWith(prefix)) throw new Error('Unexpected split-editing fixture directory');
          await fs.rm(directory, { recursive: true, force: true });
        }
      }
    }
  },
});

function pane(page: Page, which: Pane): Locator { return page.locator(`.${which}-pane`); }
function host(page: Page, which: Pane): Locator { return pane(page, which).locator(':scope > [data-document-id]'); }
function rootEditor(page: Page, which: Pane): Locator { return host(page, which).locator(':scope > .cm-editor'); }
function content(page: Page, which: Pane): Locator { return rootEditor(page, which).locator(':scope > .cm-scroller > .cm-content'); }
function inlineTitle(page: Page, which: Pane): Locator {
  return rootEditor(page, which).locator(':scope > .cm-scroller > .cm-note-title-row > .cm-inline-title');
}

async function openSplit(page: Page, file = 'side.md') {
  await page.evaluate(async file => {
    const storePath = '/src/lib/store.ts';
    await (await import(storePath)).useStore.getState().openToSide(file, 'right');
  }, file);
  await expect(host(page, 'split')).toHaveAttribute('data-document-id', file);
  await expect(content(page, 'split')).toBeVisible();
}

async function append(page: Page, which: Pane, text: string) {
  const editor = content(page, which);
  await expect(editor).toBeEditable();
  await editor.click(); await page.keyboard.press(documentEnd); await page.keyboard.type(text);
}

async function snapshot(page: Page, file: string) {
  return page.evaluate(async file => {
    const documentsPath = '/src/lib/documents.ts';
    const value = (await import(documentsPath)).documents.get(file)!.snapshot;
    return { raw: value.raw, dirty: value.dirty, saving: value.saving };
  }, file);
}

async function viewState(page: Page, which: Pane) {
  return rootEditor(page, which).evaluate(async element => {
    const viewPath = '/node_modules/.vite/deps/@codemirror_view.js';
    const view = (await import(viewPath)).EditorView.findFromDOM(element);
    const { anchor, head } = view.state.selection.main;
    return { text: view.state.doc.toString(), anchor, head, readOnly: view.state.readOnly };
  });
}

async function setMode(page: Page, which: Pane, mode: 'live' | 'source' | 'reading') {
  // Use the existing view-bound mode API, including when the view is read-only.
  await rootEditor(page, which).evaluate(async (element, mode) => {
    const viewPath = '/node_modules/.vite/deps/@codemirror_view.js', activePath = '/src/lib/activeEditor.ts';
    const view = (await import(viewPath)).EditorView.findFromDOM(element);
    (await import(activePath)).setEditorMode(view, mode);
  }, mode);
  await expect(host(page, which)).toHaveAttribute('data-mode', mode);
}

async function leaveSplit(page: Page, exit: Exit) {
  if (exit === 'close') await pane(page, 'split').getByRole('button', { name: '关闭分屏', exact: true }).click();
  else await page.evaluate(async () => {
    const storePath = '/src/lib/store.ts';
    await (await import(storePath)).useStore.getState().openToSide('replacement.md');
  });
}

async function expectExited(page: Page, exit: Exit) {
  if (exit === 'close') await expect(pane(page, 'split')).toHaveCount(0);
  else await expect(host(page, 'split')).toHaveAttribute('data-document-id', 'replacement.md');
}

async function gateSideWrites(page: Page) {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let started = false;
  const handler = async (route: Route) => {
    if (route.request().method() !== 'PUT' || route.request().postDataJSON().path !== 'side.md') return route.fallback();
    started = true;
    await gate; await route.fallback();
  };
  await page.route('**/api/files/content', handler);
  return { waitForSave: () => expect.poll(() => started, { timeout: 10000 }).toBe(true),
    release, stop: () => page.unroute('**/api/files/content', handler) };
}

test('both panes take keyboard input and manual Save targets the focused document on disk', async ({ page, backend }) => {
  await openSplit(page);
  await expect(host(page, 'main')).toHaveAttribute('data-mode', 'live');
  await expect(host(page, 'split')).toHaveAttribute('data-mode', 'live');
  await append(page, 'main', ' LEFT');
  await append(page, 'split', ' RIGHT');
  await expect.poll(() => snapshot(page, 'main.md')).toMatchObject({ raw: original['main.md'] + ' LEFT' });
  await expect.poll(() => snapshot(page, 'side.md')).toMatchObject({ raw: original['side.md'] + ' RIGHT' });
  // Exercise the global Save command, not just a direct session.save().
  await page.evaluate(async () => {
    const pluginsPath = '/src/lib/plugins.ts';
    await (await import(pluginsPath)).sharedApp.commands.execute('save');
  });
  const sideSaved = original['side.md'].replace('，', ',') + ' RIGHT';
  await expect.poll(() => fs.readFile(path.join(backend.vault, 'side.md'), 'utf8')).toBe(sideSaved);
  // Autosave may save the main draft, but must not run the manual formatter on it.
  await expect.poll(() => fs.readFile(path.join(backend.vault, 'main.md'), 'utf8')).toBe(original['main.md'] + ' LEFT');
  await expect.poll(() => snapshot(page, 'main.md')).toMatchObject({ raw: original['main.md'] + ' LEFT' });
  await content(page, 'main').focus(); await page.keyboard.press(mod + '+s');
  const mainSaved = original['main.md'].replace('，', ',') + ' LEFT';
  await expect.poll(() => fs.readFile(path.join(backend.vault, 'main.md'), 'utf8')).toBe(mainSaved);
  expect(await fs.readFile(path.join(backend.vault, 'side.md'), 'utf8')).toBe(sideSaved);
  expect(await fs.readFile(path.join(backend.vault, 'replacement.md'), 'utf8')).toBe(original['replacement.md']);
  await expect.poll(() => snapshot(page, 'main.md')).toMatchObject({ dirty: false, saving: false });
  await expect.poll(() => snapshot(page, 'side.md')).toMatchObject({ dirty: false, saving: false });
  await page.screenshot({ path: test.info().outputPath('both-panes-edited-and-saved.png') });
});

test('live, source and reading mode belong to each pane rather than the shared workspace', async ({ page, backend }) => {
  await setMode(page, 'main', 'source');
  await openSplit(page);
  await expect(host(page, 'main')).toHaveAttribute('data-mode', 'source');
  await expect(host(page, 'split')).toHaveAttribute('data-mode', 'live');
  await setMode(page, 'split', 'source');
  await expect(host(page, 'main')).toHaveAttribute('data-mode', 'source');
  await setMode(page, 'split', 'reading');
  await expect(content(page, 'split')).not.toBeEditable();
  await expect(host(page, 'main')).toHaveAttribute('data-mode', 'source');
  // Keyboard focus stays on this concrete read-only view, not the other editor.
  await rootEditor(page, 'split').evaluate(async element => {
    const viewPath = '/node_modules/.vite/deps/@codemirror_view.js';
    (await import(viewPath)).EditorView.findFromDOM(element).focus();
  });
  await page.keyboard.type('BLOCKED');
  expect((await snapshot(page, 'side.md')).raw).toBe(original['side.md']);
  expect((await snapshot(page, 'main.md')).raw).toBe(original['main.md']);
  await append(page, 'main', ' MAIN SOURCE');
  await setMode(page, 'main', 'reading');
  await setMode(page, 'split', 'live');
  await expect(content(page, 'main')).not.toBeEditable();
  await expect(host(page, 'main')).toHaveAttribute('data-mode', 'reading');
  await append(page, 'split', ' SIDE LIVE');
  await setMode(page, 'split', 'source');
  await expect(host(page, 'main')).toHaveAttribute('data-mode', 'reading');
  await setMode(page, 'main', 'live');
  await expect(host(page, 'split')).toHaveAttribute('data-mode', 'source');
  expect((await viewState(page, 'main')).text).toBe(original['main.md'] + ' MAIN SOURCE');
  expect((await viewState(page, 'split')).text).toBe(original['side.md'] + ' SIDE LIVE');
  expect(await fs.readFile(path.join(backend.vault, 'replacement.md'), 'utf8')).toBe(original['replacement.md']);
});

test('same-document panes synchronize text but keep selections local and share undo/redo', async ({ page, backend }) => {
  await openSplit(page, 'main.md');
  await setMode(page, 'main', 'source'); await setMode(page, 'split', 'source');
  await content(page, 'main').click(); await page.keyboard.press(documentStart);
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
  for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowRight');
  expect(await viewState(page, 'main')).toMatchObject({ anchor: 2, head: 6 });
  await append(page, 'split', ' SHARED');
  const shared = original['main.md'] + ' SHARED';
  await expect.poll(() => viewState(page, 'main')).toMatchObject({ text: shared, anchor: 2, head: 6 });
  await expect.poll(() => viewState(page, 'split')).toMatchObject({ text: shared, anchor: shared.length, head: shared.length });
  await content(page, 'main').focus(); await page.keyboard.type('Renamed');
  const renamed = shared.replace('# Main', '# Renamed');
  await expect.poll(() => viewState(page, 'split')).toMatchObject({ text: renamed, anchor: renamed.length, head: renamed.length });
  await expect.poll(() => viewState(page, 'main')).toMatchObject({ text: renamed, anchor: 9, head: 9 });
  // Undo in the other pane must undo the last edit, irrespective of its owner.
  await content(page, 'split').focus(); await page.keyboard.press(mod + '+z');
  for (const which of ['main', 'split'] as const) await expect.poll(() => viewState(page, which)).toMatchObject({ text: shared });
  await page.keyboard.press(mod + '+z');
  for (const which of ['main', 'split'] as const) await expect.poll(() => viewState(page, which)).toMatchObject({ text: original['main.md'] });
  await page.keyboard.press(mod + '+Shift+z'); await page.keyboard.press(mod + '+Shift+z');
  for (const which of ['main', 'split'] as const) await expect.poll(() => viewState(page, which)).toMatchObject({ text: renamed });
  await page.keyboard.press(mod + '+s');
  await expect.poll(() => fs.readFile(path.join(backend.vault, 'main.md'), 'utf8')).toBe(renamed.replace('，', ','));
  expect(await fs.readFile(path.join(backend.vault, 'side.md'), 'utf8')).toBe(original['side.md']);
});

for (const exit of ['close', 'replace'] as const) {
  test(`${exit} waits for the split draft to reach disk before removing its editor`, async ({ page, backend }) => {
    await openSplit(page);
    const gate = await gateSideWrites(page);
    let leaving: Promise<void> | undefined;
    try {
      await append(page, 'split', ' BEFORE EXIT');
      leaving = leaveSplit(page, exit);
      await gate.waitForSave();
      await expect(host(page, 'split')).toHaveAttribute('data-document-id', 'side.md');
      expect((await snapshot(page, 'side.md')).saving).toBe(true);
      expect(await fs.readFile(path.join(backend.vault, 'side.md'), 'utf8')).toBe(original['side.md']);
      gate.release(); await leaving;
      await expectExited(page, exit);
      expect(await fs.readFile(path.join(backend.vault, 'side.md'), 'utf8')).toBe(original['side.md'] + ' BEFORE EXIT');
      expect((await snapshot(page, 'side.md')).dirty).toBe(false);
      expect(await fs.readFile(path.join(backend.vault, 'main.md'), 'utf8')).toBe(original['main.md']);
      expect(await fs.readFile(path.join(backend.vault, 'replacement.md'), 'utf8')).toBe(original['replacement.md']);
    } finally { gate.release(); await leaving; await gate.stop(); }
  });
}

test.describe('failed split saves', () => {
  test.use({ expectedErrors: ['507'] });
  for (const exit of ['close', 'replace'] as const) {
    test(`${exit} keeps the editable split and unsaved source after a controlled save failure`, async ({ page, backend }) => {
      await openSplit(page);
      let failures = 0;
      const fail = async (route: Route) => {
        if (route.request().method() !== 'PUT' || route.request().postDataJSON().path !== 'side.md') return route.fallback();
        failures++;
        await route.fulfill({ status: 507, json: { error: 'split fixture forced save failure' } });
      };
      await page.route('**/api/files/content', fail);
      try {
        await append(page, 'split', ' UNSAVED');
        await leaveSplit(page, exit);
        await expect.poll(() => failures).toBeGreaterThan(0);
        await expect.poll(() => snapshot(page, 'side.md')).toMatchObject({ raw: original['side.md'] + ' UNSAVED', dirty: true, saving: false });
        await expect(host(page, 'split')).toHaveAttribute('data-document-id', 'side.md');
        await expect(content(page, 'split')).toBeEditable();
        expect(await fs.readFile(path.join(backend.vault, 'side.md'), 'utf8')).toBe(original['side.md']);
      } finally { await page.unroute('**/api/files/content', fail); }
      await append(page, 'split', ' RETRY');
      await leaveSplit(page, exit); await expectExited(page, exit);
      expect(await fs.readFile(path.join(backend.vault, 'side.md'), 'utf8')).toBe(original['side.md'] + ' UNSAVED RETRY');
      expect(await fs.readFile(path.join(backend.vault, 'main.md'), 'utf8')).toBe(original['main.md']);
      expect(await fs.readFile(path.join(backend.vault, 'replacement.md'), 'utf8')).toBe(original['replacement.md']);
    });
  }
});

test('typing during a split-close save keeps the split and the newest draft for a retry', async ({ page, backend }) => {
  await openSplit(page);
  const gate = await gateSideWrites(page);
  let leaving: Promise<void> | undefined;
  try {
    await append(page, 'split', ' FIRST');
    leaving = leaveSplit(page, 'close'); await gate.waitForSave();
    await expect(host(page, 'split')).toHaveAttribute('data-document-id', 'side.md');
    await append(page, 'split', ' NEWEST');
    gate.release(); await leaving;
    await expect.poll(() => snapshot(page, 'side.md')).toMatchObject({ saving: false });
    await expect(host(page, 'split')).toHaveAttribute('data-document-id', 'side.md');
    await expect.poll(() => snapshot(page, 'side.md')).toMatchObject({ raw: original['side.md'] + ' FIRST NEWEST' });
    await expect(content(page, 'split')).toBeEditable();
    await leaveSplit(page, 'close'); await expectExited(page, 'close');
    expect(await fs.readFile(path.join(backend.vault, 'side.md'), 'utf8')).toBe(original['side.md'] + ' FIRST NEWEST');
    expect(await fs.readFile(path.join(backend.vault, 'main.md'), 'utf8')).toBe(original['main.md']);
  } finally { gate.release(); await leaving; await gate.stop(); }
});

// These compare the same mode/content, not editing against reading: selection,
// reveal and read-only affordances must not disguise a pane-specific layout path.
async function openParityNote(page: Page, file: string, mode: 'live' | 'source' | 'reading') {
  await page.evaluate(async file => {
    const storePath = '/src/lib/store.ts';
    await (await import(storePath)).useStore.getState().openFile(file);
  }, file);
  await expect(host(page, 'main')).toHaveAttribute('data-document-id', file);
  await openSplit(page, file);
  await setMode(page, 'main', mode); await setMode(page, 'split', mode);
  await page.evaluate(async () => {
    const viewPath = '/node_modules/.vite/deps/@codemirror_view.js';
    const { EditorView } = await import(viewPath);
    for (const element of document.querySelectorAll('.editor-area > .pane > [data-document-id] > .cm-editor')) {
      const view = EditorView.findFromDOM(element);
      view.dispatch({ selection: { anchor: view.state.doc.length } });
      view.scrollDOM.scrollTop = 0; view.scrollDOM.scrollLeft = 0; view.requestMeasure();
    }
    await document.fonts.ready;
  });
  await page.mouse.move(0, 0);
  for (const which of ['main', 'split'] as const) {
    await expect(inlineTitle(page, which)).toHaveText(file.replace(/\.md$/, ''));
    if (file === 'parity-rich.md') {
      await expect(content(page, which)).toContainText('Parity tail sentinel');
      if (mode !== 'source') {
        await expect(pane(page, which).locator('.cm-properties-block')).toHaveCount(1);
        await expect(pane(page, which).locator('.md-callout[data-callout="note"]')).toHaveCount(1);
        await expect(pane(page, which).locator('table.cm-table')).toHaveCount(1);
        // MathJax may split one formula into multiple SVG fragments.
        for (const kind of ['math-inline', 'math-block']) {
          const output = content(page, which).locator(`.cm-math-rendered.${kind} > .cm-math-body > [data-mathjax-version]`);
          await expect(output).toHaveCount(1);
          await expect(output.locator('svg')).not.toHaveCount(0);
          await expect(output.locator('[data-mml-node="merror"]')).toHaveCount(0);
        }
      } else {
        await expect(content(page, which)).toContainText('status: parity');
        await expect(content(page, which).locator('.cm-math-rendered > .cm-math-body > [data-mathjax-version]')).toHaveCount(0);
      }
    } else await expect(content(page, which)).toHaveText('');
  }
  await expect(page.locator('.editor-area [data-render-pending], .editor-area [data-render-error]')).toHaveCount(0);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}

async function parityMetrics(page: Page) {
  return page.evaluate(() => (['main', 'split'] as const).map(which => {
    const pane = document.querySelector<HTMLElement>(`.${which}-pane`)!;
    const host = pane.querySelector<HTMLElement>(':scope > [data-document-id]')!;
    const scroller = host.querySelector<HTMLElement>(':scope > .cm-editor > .cm-scroller')!;
    const close = pane.querySelector<HTMLElement>(':scope > .pane-close')!;
    const paneRect = pane.getBoundingClientRect(), paneStyle = getComputedStyle(pane);
    const borderLeft = parseFloat(paneStyle.borderLeftWidth), borderTop = parseFloat(paneStyle.borderTopWidth);
    // Use the pane content box; an inset divider must not shift the document.
    const origin = { left: paneRect.left + borderLeft, top: paneRect.top + borderTop };
    const shape = (element: Element) => ({ tag: element.tagName,
      classes: [...element.classList].filter(name => name !== 'cm-focused').sort() });
    const paintedBackground = (element: Element): string => {
      for (let current: Element | null = element; current; current = current.parentElement) {
        const color = getComputedStyle(current).backgroundColor;
        if (color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)') return color;
      }
      return 'transparent';
    };
    const measure = (element: Element) => {
      const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
      return {
        box: { left: rect.left - origin.left, top: rect.top - origin.top, width: rect.width, height: rect.height },
        style: Object.fromEntries([
          'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing',
          'color', 'backgroundColor', 'boxSizing', 'display', 'position', 'maxWidth',
          'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'marginTop', 'marginBottom',
          'textIndent', 'whiteSpace', 'borderTopWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderRightWidth',
          'borderTopColor', 'borderBottomColor', 'borderLeftColor', 'borderRightColor',
        ].map(key => [key, style[key as keyof CSSStyleDeclaration]])),
        paintedBackground: paintedBackground(element),
      };
    };
    const selectors = {
      host: ':scope', editor: ':scope > .cm-editor', scroller: ':scope > .cm-editor > .cm-scroller',
      titleRow: ':scope > .cm-editor > .cm-scroller > .cm-note-title-row',
      title: ':scope > .cm-editor > .cm-scroller > .cm-note-title-row > .cm-inline-title',
      content: ':scope > .cm-editor > .cm-scroller > .cm-content',
      propertiesBlock: '.cm-properties-block', properties: '.cm-properties', propertiesRows: '.cm-properties .prop-row',
      h1: '.HyperMD-header-1', h2: '.HyperMD-header-2', quote: '.md-quote', callout: '.md-callout', calloutTitle: '.md-callout-title',
      table: 'table.cm-table', tableHead: 'table.cm-table th', tableBody: 'table.cm-table td',
      inlineMath: '.math-inline', displayMath: '.math-block', mathSvg: '.math-inline svg, .math-block svg',
      footer: ':scope > .cm-editor > .cm-scroller > .cm-note-footer',
    };
    const nodes = Object.fromEntries(Object.entries(selectors).map(([key, selector]) =>
      [key, (key === 'host' ? [host] : [...host.querySelectorAll(selector)]
        .filter(element => element.closest('[data-document-id]') === host)).map(measure)]));
    const bodyLines = [...scroller.querySelectorAll(':scope > .cm-content .cm-line')].filter(line =>
      line.closest('[data-document-id]') === host && (line.textContent?.startsWith('Parity body') || line.textContent === 'Parity tail sentinel'));
    const closeRect = close?.getBoundingClientRect();
    return {
      shell: {
        classes: [...pane.classList].filter(name => name !== 'main-pane' && name !== 'split-pane').sort(),
        children: [...pane.children].map(shape), hostChildren: [...host.children].map(shape),
        documentChildren: [...scroller.children]
          .filter(element => element.matches('.cm-note-title-row, .cm-content, .cm-note-footer')).map(shape),
        innerWidth: paneRect.width - borderLeft - parseFloat(paneStyle.borderRightWidth),
        innerHeight: paneRect.height - borderTop - parseFloat(paneStyle.borderBottomWidth),
        background: paneStyle.backgroundColor, paintedBackground: paintedBackground(pane),
      },
      close: close && closeRect ? {
        outsideDocument: !host.contains(close), offsetParentIsPane: close.offsetParent === pane,
        position: getComputedStyle(close).position,
        top: closeRect.top - origin.top,
        right: paneRect.right - parseFloat(paneStyle.borderRightWidth) - closeRect.right,
        width: closeRect.width, height: closeRect.height,
      } : null,
      document: { mode: host.dataset.mode, nodes, bodyLines: bodyLines.map(measure),
        scrollTop: scroller.scrollTop, scrollLeft: scroller.scrollLeft },
    };
  }));
}

function expectPaneParity(main: unknown, split: unknown, label: string): void {
  if (typeof main === 'number' && typeof split === 'number') {
    expect(Math.abs(main - split), label + ' (CSS px)').toBeLessThanOrEqual(0.1);
  } else if (Array.isArray(main) && Array.isArray(split)) {
    expect(split.length, label + ' count').toBe(main.length);
    main.forEach((value, index) => expectPaneParity(value, split[index], `${label}[${index}]`));
  } else if (main !== null && split !== null && typeof main === 'object' && typeof split === 'object') {
    const left = main as Record<string, unknown>, right = split as Record<string, unknown>;
    expect(Object.keys(right).sort(), label + ' keys').toEqual(Object.keys(left).sort());
    for (const key of Object.keys(left)) expectPaneParity(left[key], right[key], `${label}.${key}`);
  } else expect(split, label).toEqual(main);
}

async function parityPaintedFonts(page: Page, rich: boolean) {
  if (rich) await page.locator('.editor-area > .pane > [data-document-id]').evaluateAll(hosts => {
    for (const host of hosts) for (const line of host.querySelectorAll(':scope > .cm-editor > .cm-scroller > .cm-content .cm-line')) {
      if (line.closest('[data-document-id]') === host && line.textContent?.startsWith('Parity body')) line.setAttribute('data-parity-font-body', '');
    }
  });
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument');
    const results = [];
    for (const which of ['main', 'split'] as const) {
      const samples = [];
      for (const selector of ['.cm-note-title-row > .cm-inline-title', ...(rich ? ['.cm-content [data-parity-font-body]'] : [])]) {
        const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId,
          selector: `.${which}-pane > [data-document-id] > .cm-editor > .cm-scroller > ${selector}` });
        expect(nodeId, which + ' painted font probe ' + selector).toBeGreaterThan(0);
        const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
        expect(fonts.length, which + ' actual painted glyphs ' + selector).toBeGreaterThan(0);
        samples.push({ selector, fonts: fonts.map(font => ({ family: font.familyName, postscript: font.postScriptName,
          custom: font.isCustomFont, glyphs: font.glyphCount })).sort((a, b) => a.family.localeCompare(b.family) || a.postscript.localeCompare(b.postscript)) });
      }
      results.push(samples);
    }
    return results;
  } finally { await cdp.detach(); }
}

for (const theme of ['light', 'dark'] as const) for (const mode of ['live', 'source', 'reading'] as const) {
  for (const file of ['parity-rich.md', 'parity-blank.md'] as const) {
    test(`${theme} ${mode} ${file}: same-note panes share shell, geometry, typography and painted surfaces`, async ({ page, backend }, info) => {
      await page.setViewportSize({ width: 2400, height: 1800 });
      await page.evaluate(async theme => {
        const apiPath = '/src/lib/api.ts';
        await (await import(apiPath)).api.putSettings({ ui: { theme: 'obsidian-' + theme, fontTextSize: 18, fileLineWidth: 700 } });
      }, theme);
      await expect(page.locator('body')).toHaveClass(new RegExp('theme-' + theme));
      await openParityNote(page, file, mode);
      await expect(page.locator('.workspace .split-head')).toHaveCount(0);
      for (const which of ['main', 'split'] as const) {
        const close = pane(page, which).locator(':scope > button.pane-close');
        await expect(close).toHaveCount(1);
        await expect(close).toHaveAttribute('title', which === 'main' ? '关闭标签页' : '关闭分屏');
      }
      await expect.poll(async () => {
        const before = await parityMetrics(page);
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        return JSON.stringify(await parityMetrics(page)) === JSON.stringify(before);
      }).toBe(true);
      const metrics = await parityMetrics(page);
      const fonts = await parityPaintedFonts(page, file === 'parity-rich.md');
      const evidence = JSON.stringify({ theme, mode, file, metrics, fonts }, null, 2);
      await info.attach('pane-parity', { body: evidence, contentType: 'application/json' });
      await fs.writeFile(info.outputPath('pane-parity.json'), evidence);
      expectPaneParity(metrics[0], metrics[1], 'same-note pane parity');
      expect(fonts[1], 'actual glyph fonts must match, not just CSS fallback declarations').toEqual(fonts[0]);
      for (const metric of metrics) {
        expect(metric.close).toMatchObject({ outsideDocument: true, offsetParentIsPane: true, position: 'absolute' });
        expect(metric.document.nodes.host[0].box.top, 'no pane-specific header above the document').toBe(0);
        expect(metric.document.nodes.host[0].box.height).toBe(metric.shell.innerHeight);
        expect(metric.document.nodes.content[0].style.fontSize).toBe('18px');
        expect(metric.document.nodes.content[0].style.maxWidth).toBe('700px');
        expect(metric.document.nodes.content[0].box.width).toBe(700);
        expect(metric.document.nodes.title[0].box.width).toBe(700);
      }
      // A close control must not consume a row, even when both controls vanish.
      const controls = page.locator('.editor-area > .pane > .pane-close');
      const savedStyles = await controls.evaluateAll(elements => elements.map(element => {
        const previous = element.getAttribute('style'); (element as HTMLElement).style.display = 'none'; return previous;
      }));
      try {
        const withoutControls = await parityMetrics(page);
        for (let i = 0; i < metrics.length; i++) expectPaneParity(metrics[i].document, withoutControls[i].document, 'close overlay does not affect document flow');
      } finally {
        await controls.evaluateAll((elements, styles) => elements.forEach((element, index) => {
          const style = styles[index]; if (style === null) element.removeAttribute('style'); else element.setAttribute('style', style);
        }), savedStyles);
      }
      expect(await fs.readFile(path.join(backend.vault, file), 'utf8')).toBe(original[file]);
      expect((await snapshot(page, file)).dirty).toBe(false);
      await page.screenshot({ path: info.outputPath(`${theme}-${mode}-${file}.png`) });
    });
  }
}

async function workspacePaneBindings(page: Page, activePane: Pane) {
  return page.evaluate(async activePane => {
    const pluginsPath = '/src/lib/plugins.ts', workspacePath = '/src/lib/obsidian/workspace.ts';
    const viewPath = '/node_modules/.vite/deps/@codemirror_view.js', contextPath = '/src/lib/renderContext.ts';
    const { sharedApp } = await import(pluginsPath), { MarkdownView } = await import(workspacePath);
    const { EditorView } = await import(viewPath), { contextOf } = await import(contextPath);
    const workspace = sharedApp.workspace;
    const main = workspace.markdown('main'), split = workspace.markdown('split');
    const expected = EditorView.findFromDOM(document.querySelector(`.${activePane}-pane > [data-document-id] > .cm-editor`)!);
    const active = workspace.activeLeaf, activeView = workspace.getActiveViewOfType(MarkdownView);
    return {
      main: { pane: main?.editor.cm.dom.closest('.pane')?.classList.contains('main-pane'),
        contextId: main && contextOf(main.editor.cm).navigationId, readOnly: main?.editor.cm.state.readOnly, path: main?.file?.path },
      split: { pane: split?.editor.cm.dom.closest('.pane')?.classList.contains('split-pane'),
        contextId: split && contextOf(split.editor.cm).navigationId, readOnly: split?.editor.cm.state.readOnly, path: split?.file?.path },
      distinctViews: !!main && !!split && main.editor.cm !== split.editor.cm,
      activeSlot: active.slot, activeEditorMatches: active.view instanceof MarkdownView && active.view.editor.cm === expected,
      activeContainerMatches: active.view.containerEl === expected.dom.closest('.cm-host'),
      activeViewMatches: activeView?.editor.cm === expected,
      leaves: workspace.getLeavesOfType('markdown').map((leaf: { slot: string }) => leaf.slot).sort(),
    };
  }, activePane);
}

for (const mode of ['live', 'source', 'reading'] as const) {
  test(`same-file ${mode} activeLeaf and workspace close command target the actual pane`, async ({ page, backend }) => {
    for (const target of ['split', 'main'] as const) {
      await openSplit(page, 'main.md');
      await setMode(page, 'main', mode); await setMode(page, 'split', mode);
      // The inline filename remains a real focus target in reading mode; do not
      // fabricate focus events or identify a leaf by readOnly/file-path equality.
      await inlineTitle(page, target).click();
      await expect.poll(() => workspacePaneBindings(page, target)).toEqual({
        main: { pane: true, contextId: 'main', readOnly: mode === 'reading', path: 'main.md' },
        split: { pane: true, contextId: 'split', readOnly: mode === 'reading', path: 'main.md' },
        distinctViews: true, activeSlot: target, activeEditorMatches: true, activeContainerMatches: true, activeViewMatches: true,
        leaves: ['main', 'split'],
      });
      await page.evaluate(async () => {
        const pluginsPath = '/src/lib/plugins.ts';
        await (await import(pluginsPath)).sharedApp.commands.execute('workspace:close');
      });
      const survivor = target === 'main' ? 'split' : 'main';
      if (target === 'split') await expect(pane(page, 'split')).toHaveCount(0);
      else await expect(pane(page, 'main')).toHaveCount(0);
      await expect(host(page, survivor)).toHaveAttribute('data-document-id', 'main.md');
      await expect(host(page, survivor)).toHaveAttribute('data-mode', mode);
      expect((await viewState(page, survivor)).readOnly).toBe(mode === 'reading');
      await expect.poll(() => page.evaluate(async () => {
        const pluginsPath = '/src/lib/plugins.ts';
        return (await import(pluginsPath)).sharedApp.workspace.getLeavesOfType('markdown').map((leaf: { slot: string }) => leaf.slot);
      })).toEqual([survivor]);
      expect(await fs.readFile(path.join(backend.vault, 'main.md'), 'utf8')).toBe(original['main.md']);
      expect((await snapshot(page, 'main.md')).raw).toBe(original['main.md']);
    }
  });
}

for (const target of ['main', 'split'] as const) {
  test(`pointer on readonly blank ${target} selects that pane for real palette mode and close actions`, async ({ page, backend }, info) => {
    const other: Pane = target === 'main' ? 'split' : 'main';
    const file = 'parity-blank.md';
    const chooseCommand = async (name: string) => {
      await page.keyboard.press(mod + '+p');
      const input = page.getByRole('combobox', { name: '搜索命令', exact: true });
      await expect(input).toBeVisible(); await input.fill(name);
      const option = page.getByRole('option').filter({ has: page.getByText(name, { exact: true }) });
      await expect(option).toHaveCount(1); await option.click();
      await expect(page.getByRole('dialog', { name: '命令面板', exact: true })).toHaveCount(0);
    };
    await openParityNote(page, file, 'reading');
    for (const which of ['main', 'split'] as const) await expect(content(page, which)).not.toBeEditable();
    await inlineTitle(page, other).click();
    await expect.poll(() => workspacePaneBindings(page, other)).toMatchObject({ activeSlot: other, activeEditorMatches: true });

    // A real click on the unfocusable blank reading body must replace the prior
    // active view, without a test-supplied focus/caret or mode dispatch.
    await content(page, target).click();
    await expect.poll(() => workspacePaneBindings(page, target)).toMatchObject({ activeSlot: target, activeEditorMatches: true });
    await chooseCommand('切换到实时预览');
    await expect(host(page, target)).toHaveAttribute('data-mode', 'live');
    await expect(content(page, target)).toBeEditable();
    await expect(host(page, other)).toHaveAttribute('data-mode', 'reading');
    await expect(content(page, other)).not.toBeEditable();

    const typed = `Pointer ${target}，shared edit`;
    await append(page, target, typed); await page.keyboard.press(mod + '+s');
    const saved = typed.replace('，', ',');
    await expect.poll(() => fs.readFile(path.join(backend.vault, file), 'utf8')).toBe(saved);
    await expect.poll(() => viewState(page, target)).toMatchObject({ text: saved, readOnly: false });
    await expect.poll(() => viewState(page, other)).toMatchObject({ text: saved, readOnly: true });
    await expect.poll(() => snapshot(page, file)).toMatchObject({ raw: saved, dirty: false, saving: false });
    expect(await fs.readFile(path.join(backend.vault, 'main.md'), 'utf8')).toBe(original['main.md']);
    expect(await fs.readFile(path.join(backend.vault, 'side.md'), 'utf8')).toBe(original['side.md']);
    await page.screenshot({ path: info.outputPath(`readonly-pointer-${target}-mode-edit-save.png`) });

    await chooseCommand('切换到阅读模式');
    for (const which of ['main', 'split'] as const) await expect(host(page, which)).toHaveAttribute('data-mode', 'reading');
    await inlineTitle(page, other).click();
    await expect.poll(() => workspacePaneBindings(page, other)).toMatchObject({ activeSlot: other, activeEditorMatches: true });
    await content(page, target).click();
    await chooseCommand('关闭当前标签页');
    if (target === 'split') await expect(pane(page, 'split')).toHaveCount(0);
    else await expect(host(page, 'main')).not.toHaveAttribute('data-document-id', file);
    await expect(host(page, other)).toHaveAttribute('data-document-id', file);
    await expect(host(page, other)).toHaveAttribute('data-mode', 'reading');
    await expect.poll(() => viewState(page, other)).toMatchObject({ text: saved, readOnly: true });
    expect(await fs.readFile(path.join(backend.vault, file), 'utf8')).toBe(saved);
  });
}

test('focused page routing: file picker replaces the focused split and preserves main', async ({ page, backend }) => {
  await openSplit(page);
  await content(page, 'split').click();
  await page.keyboard.press(mod + '+o');
  await page.locator('.palette-input').fill('replacement');
  await page.keyboard.press('Enter');
  await expect(host(page, 'split')).toHaveAttribute('data-document-id', 'replacement.md');
  await expect(host(page, 'main')).toHaveAttribute('data-document-id', 'main.md');
});

test('focused page routing: bookmark and move commands use the focused reading page', async ({ page, backend }) => {
  await openSplit(page);
  await setMode(page, 'split', 'reading');
  await rootEditor(page, 'split').click({ position: { x: 30, y: 300 } });
  await runPageCommand(page, 'bookmark');
  await runPageCommand(page, 'move');
  expect(await page.evaluate(async () => {
    const module = '/src/lib/store.ts';
    const state = (await import(module)).useStore.getState();
    return { bookmarks: state.bookmarks, move: state.movePath };
  })).toEqual({ bookmarks: ['side.md'], move: 'side.md' });
});

test('focused page routing: history is independent for main and split', async ({ page, backend }) => {
  await page.evaluate(async () => {
    const module = '/src/lib/store.ts'; const state = (await import(module)).useStore.getState();
    await state.openFile('replacement.md', true, 'main');
  });
  await expect(host(page, 'main')).toHaveAttribute('data-document-id', 'replacement.md');
  await openSplit(page);
  await content(page, 'split').click();
  await page.evaluate(async () => {
    const module = '/src/lib/store.ts'; await (await import(module)).useStore.getState().openFile('main.md');
  });
  await expect(host(page, 'split')).toHaveAttribute('data-document-id', 'main.md');
  await runPageCommand(page, 'app:go-back');
  await expect(host(page, 'split')).toHaveAttribute('data-document-id', 'side.md');
  await expect(host(page, 'main')).toHaveAttribute('data-document-id', 'replacement.md');
  await runPageCommand(page, 'app:go-forward');
  await expect(host(page, 'split')).toHaveAttribute('data-document-id', 'main.md');
  await content(page, 'main').click();
  await runPageCommand(page, 'app:go-back');
  await expect(host(page, 'main')).toHaveAttribute('data-document-id', 'main.md');
  await expect(host(page, 'split')).toHaveAttribute('data-document-id', 'main.md');
});

test('focused page routing: tab command stays in split, explicit main tab click targets main', async ({ page, backend }) => {
  await page.evaluate(async () => {
    const module = '/src/lib/store.ts'; const state = (await import(module)).useStore.getState();
    await state.openFile('replacement.md', true, 'main'); await state.openFile('main.md', true, 'main');
  });
  await openSplit(page, 'main.md');
  await inlineTitle(page, 'split').click();
  await runPageCommand(page, 'workspace:next-tab');
  await expect(host(page, 'split')).toHaveAttribute('data-document-id', 'replacement.md');
  await expect(host(page, 'main')).toHaveAttribute('data-document-id', 'main.md');
  await page.getByRole('tab', { name: /replacement/ }).click();
  await expect(host(page, 'main')).toHaveAttribute('data-document-id', 'replacement.md');
});

test('focused page routing: headings palette and outline read and navigate split', async ({ page, backend }) => {
  await openSplit(page, 'parity-rich.md');
  await content(page, 'split').click();
  await runPageCommand(page, 'headings');
  await page.locator('.palette-input').fill('Visible H2');
  await page.keyboard.press('Enter');
  await expect(rootEditor(page, 'split').locator('.cm-navigation-target')).toContainText('Visible H2');
  await runPageCommand(page, 'outline');
  await expect(page.locator('.right-sidebar .outline-item').filter({ hasText: 'Visible H2' })).toBeVisible();
  await page.locator('.right-sidebar .outline-item').filter({ hasText: 'Visible H1' }).click();
  await expect(rootEditor(page, 'split').locator('.cm-navigation-target')).toContainText('Visible H1');
  await expect(host(page, 'main')).toHaveAttribute('data-document-id', 'main.md');
});

test('focused page routing: footer mode switch and reading Save target split', async ({ page, backend }) => {
  await openSplit(page);
  await content(page, 'split').click();
  await page.locator('.view-mode-trigger').click();
  await page.getByRole('menuitemcheckbox', { name: '阅读视图' }).click();
  await expect(host(page, 'split')).toHaveAttribute('data-mode', 'reading');
  await expect(host(page, 'main')).toHaveAttribute('data-mode', 'live');
  await runPageCommand(page, 'save');
  await expect.poll(() => fs.readFile(path.join(backend.vault, 'side.md'), 'utf8')).toBe(original['side.md'].replace('，', ','));
  expect(await fs.readFile(path.join(backend.vault, 'main.md'), 'utf8')).toBe(original['main.md']);
});

test('focused page routing: sidebar picker retains its tab and close restores main routing', async ({ page, backend }) => {
  const id = await page.evaluate(async () => {
    const module = '/src/lib/store.ts'; return (await import(module)).useStore.getState().openSidebarTab('right', 'markdown', { file: 'side.md' });
  });
  const sidebar = page.locator(`[data-sidebar-tab="${id}"]`);
  await sidebar.locator('.cm-content').click();
  await page.keyboard.press(mod + '+o');
  await page.locator('.palette-input').fill('replacement'); await page.keyboard.press('Enter');
  await expect(sidebar.locator('[data-document-id]')).toHaveAttribute('data-document-id', 'replacement.md');
  await expect(host(page, 'main')).toHaveAttribute('data-document-id', 'main.md');
  await runPageCommand(page, 'workspace:close');
  await expect(sidebar).toHaveCount(0);
  await runPageCommand(page, 'bookmark');
  expect(await page.evaluate(async () => {
    const module = '/src/lib/store.ts'; return (await import(module)).useStore.getState().bookmarks;
  })).toEqual(['main.md']);
});

test('focused page routing: new Homepage and picker stay in focused split', async ({ page, backend }) => {
  await openSplit(page);
  await content(page, 'split').click();
  await runPageCommand(page, 'new-tab');
  await expect(pane(page, 'split').locator('.workspace-launcher')).toBeVisible();
  await runPageCommand(page, 'files');
  await page.locator('.palette-input').fill('replacement'); await page.keyboard.press('Enter');
  await expect(host(page, 'split')).toHaveAttribute('data-document-id', 'replacement.md');
  await expect(host(page, 'main')).toHaveAttribute('data-document-id', 'main.md');
  await runPageCommand(page, 'new-tab');
  await expect(pane(page, 'split').locator('.workspace-launcher')).toBeVisible();
  await runPageCommand(page, 'workspace:close');
  await expect(pane(page, 'split')).toHaveCount(0);
  await expect(host(page, 'main')).toHaveAttribute('data-document-id', 'main.md');
});

test('focused page routing: same-file palette mode and close keep view identities distinct', async ({ page, backend }) => {
  await openSplit(page, 'main.md');
  await inlineTitle(page, 'split').click();
  await page.keyboard.press('Escape');
  await page.keyboard.press(mod + '+p');
  await page.locator('.palette-input').fill('切换到源码模式');
  await page.keyboard.press('Enter');
  await expect(host(page, 'split')).toHaveAttribute('data-mode', 'source');
  await expect(host(page, 'main')).toHaveAttribute('data-mode', 'live');
  await runPageCommand(page, 'workspace:close');
  await expect(pane(page, 'split')).toHaveCount(0);
  await runPageCommand(page, 'reading');
  await expect(host(page, 'main')).toHaveAttribute('data-mode', 'reading');
});

test('focused page routing: new-note current folder follows split', async ({ page, backend }) => {
  await fs.mkdir(path.join(backend.vault, 'sub'));
  await fs.writeFile(path.join(backend.vault, 'sub', 'in-folder.md'), '# In folder');
  const settings = await page.request.put(backend.url + '/api/settings', { data: { vault: { newFileLocation: 'current' } } });
  expect(settings.ok()).toBe(true);
  await openSplit(page, 'sub/in-folder.md');
  await content(page, 'split').click();
  await runPageCommand(page, 'new');
  await expect(host(page, 'split')).toHaveAttribute('data-document-id', 'sub/Untitled.md');
  await expect(host(page, 'main')).toHaveAttribute('data-document-id', 'main.md');
  expect(await fs.readFile(path.join(backend.vault, 'sub', 'Untitled.md'), 'utf8')).toBe('');
});
