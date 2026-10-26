import { test as base, expect } from './test';
import type { Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const host = '# Host\n\n[[^heading-stable|Open stable]]\n\n[[^heading-other|Open other]]\n\n![[^heading-stable]]\n\nHost untouched sentinel';
const target = '# Same ^heading-stable\n\nTarget original body\n';
const other = '# Same ^heading-other\n\nOther target body\n';

const test = base.extend<{ backend: { vault: string; url: string } }>({
  backend: async ({}, use, info) => {
    const temporary = path.join(os.tmpdir(), '.agents');
    await fs.mkdir(temporary, { recursive: true });
    const directory = await fs.mkdtemp(path.join(temporary, 'content-references-browser-'));
    const vault = path.join(directory, 'vault'), data = path.join(directory, 'data');
    await fs.mkdir(path.join(vault, 'targets'), { recursive: true });
    await fs.mkdir(path.join(vault, 'moved')); await fs.mkdir(data);
    await fs.writeFile(path.join(vault, 'host.md'), host);
    await fs.writeFile(path.join(vault, 'targets', 'first.md'), target);
    await fs.writeFile(path.join(vault, 'targets', 'second.md'), other);
    const child = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
      cwd: process.cwd(), windowsHide: true,
      env: { ...process.env, PORT: '0', HOST: '127.0.0.1', DATA_DIR: data, VAULT_PATH: vault,
        ALLOWED_ROOTS: directory, WEBOBSIDIAN_INITIAL_VAULT: '', NODE_ENV: 'development' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let logs = '';
    child.stdout!.on('data', chunk => { logs += chunk.toString(); });
    child.stderr!.on('data', chunk => { logs += chunk.toString(); });
    try {
      const endpoint = path.join(data, 'operations-endpoint.json');
      await expect.poll(async () => {
        if (child.exitCode !== null) throw new Error(logs);
        return fs.readFile(endpoint, 'utf8').then(text => JSON.parse(text).url, () => '');
      }, { timeout: 20000 }).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      await use({ vault, url: JSON.parse(await fs.readFile(endpoint, 'utf8')).url });
    } finally {
      if (child.exitCode === null) {
        const closed = new Promise<void>(resolve => child.once('close', () => resolve()));
        child.kill(); await closed;
      }
      await fs.mkdir(path.dirname(info.outputPath('server.log')), { recursive: true });
      await fs.writeFile(info.outputPath('server.log'), logs);
      if (!path.resolve(directory).startsWith(path.join(temporary, 'content-references-browser-'))) throw new Error('Unexpected fixture path');
      await fs.rm(directory, { recursive: true, force: true });
    }
  },
});

test.beforeEach(async ({ page, backend }) => {
  test.setTimeout(60000);
  await page.route(/\/packages\/markdown-core\/dist\/[^?]+\.js(?:\?.*)?$/, async route => {
    const url = route.request().url().replace('/markdown-core/dist/', '/markdown-core/src/').replace(/\.js(?=\?|$)/, '.ts');
    const response = await route.fetch({ url });
    await route.fulfill({ response });
  });
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: backend.url + url.pathname + url.search });
    await route.fulfill({ response });
  });
  await page.routeWebSocket('**/ws', () => {});
  await page.routeWebSocket(url => url.searchParams.has('token'), socket => socket.send(JSON.stringify({ type: 'connected' })));
  await page.goto('/__render-test');
  await page.waitForFunction(() => !!window.renderHarness);
  await page.evaluate(async () => {
    const storePath = '/src/lib/store.ts';
    const { useStore } = await import(storePath);
    useStore.getState().setViewMode('reading');
    await window.renderHarness.workspace('host.md');
  });
  await expect(page.locator('.workspace')).toContainText('Host untouched sentinel');
  await expect(page.locator('.workspace .cm-note-embed')).toContainText('Target original body');
  await expect(page.locator('.workspace .cm-note-embed .cm-leading-heading')).toBeVisible();
  await expect(page.locator('.workspace .cm-note-embed .cm-leading-heading')).toContainText('Same');
  await expect(page.locator('.workspace .cm-footnote-entry')).toHaveCount(0);
  await expect(page.locator('.workspace .cm-footnote-reference')).toHaveCount(0);
});

async function activePath(page: Page) {
  return page.evaluate(async () => {
    const modulePath = '/src/lib/store.ts';
    return (await import(modulePath)).useStore.getState().activePath;
  });
}

async function openHost(page: Page) {
  await page.evaluate(async () => {
    const modulePath = '/src/lib/store.ts';
    await (await import(modulePath)).useStore.getState().openFile('host.md');
  });
  await expect(page.locator('.workspace')).toContainText('Host untouched sentinel');
}

async function resolve(page: Page, reference: string) {
  return page.evaluate(async reference => {
    const modulePath = '/src/lib/api.ts';
    return (await import(modulePath)).api.resolve(reference, 'host.md');
  }, reference);
}

test('saved global heading links navigate after heading rename and file move without rewriting the host', async ({ page, backend }, info) => {
  expect(await resolve(page, '^heading-stable')).toMatchObject({ path: 'targets/first.md', status: 'resolved' });
  await page.getByText('Open stable', { exact: true }).click();
  await expect.poll(() => activePath(page)).toBe('targets/first.md');
  await expect(page.locator('.workspace .cm-navigation-target')).toContainText('Same');
  await page.evaluate(async () => {
    const documentsPath = '/src/lib/documents.ts', storePath = '/src/lib/store.ts';
    const { documents } = await import(documentsPath);
    const session = documents.get('targets/first.md')!;
    const from = session.snapshot.text.indexOf('Same');
    session.edit(session.snapshot.version, [{ from, to: from + 4, insert: 'Renamed title' }], 'integration-heading-rename');
    await session.save();
    await (await import(storePath)).useStore.getState().renamePath('targets/first.md', 'moved/renamed.md');
  });
  const saved = target.replace('Same', 'Renamed title');
  expect(await fs.readFile(path.join(backend.vault, 'moved', 'renamed.md'), 'utf8')).toBe(saved);
  await expect(fs.stat(path.join(backend.vault, 'targets', 'first.md'))).rejects.toThrow();
  await expect.poll(() => resolve(page, '^heading-stable')).toMatchObject({ path: 'moved/renamed.md', status: 'resolved' });
  await openHost(page);
  await page.getByText('Open stable', { exact: true }).click();
  await expect.poll(() => activePath(page)).toBe('moved/renamed.md');
  await expect(page.locator('.workspace .cm-navigation-target')).toContainText('Renamed title');
  expect(await fs.readFile(path.join(backend.vault, 'host.md'), 'utf8')).toBe(host);
  await page.screenshot({ path: info.outputPath('renamed-moved-navigation.png') });
});

test('same-name saved headings retain distinct identities and duplicates and malformed IDs fail without phantom notes', async ({ page, backend }) => {
  await page.getByText('Open stable', { exact: true }).click();
  await expect.poll(() => activePath(page)).toBe('targets/first.md');
  await expect(page.locator('.workspace')).toContainText('Target original body');
  await openHost(page);
  await page.getByText('Open other', { exact: true }).click();
  await expect.poll(() => activePath(page)).toBe('targets/second.md');
  await expect(page.locator('.workspace')).toContainText('Other target body');
  await page.evaluate(async () => {
    const modulePath = '/src/lib/api.ts';
    await (await import(modulePath)).api.createText('duplicate.md', '# Duplicate ^heading-stable\n');
  });
  await expect.poll(() => resolve(page, '^heading-stable')).toMatchObject({ path: null, status: 'ambiguous' });
  await page.evaluate(async () => {
    const modulePath = '/src/lib/store.ts';
    const store = (await import(modulePath)).useStore;
    for (const reference of ['^heading-stable', '^heading-', '^heading-bad_id']) await store.getState().openWikilink(reference, 'host.md');
  });
  expect(await activePath(page)).toBe('targets/second.md');
  expect(await fs.readdir(backend.vault)).toEqual(expect.arrayContaining(['duplicate.md', 'host.md', 'moved', 'targets']));
  expect((await fs.readdir(backend.vault)).filter(name => name.startsWith('^') || name === '.md')).toEqual([]);
  expect(await fs.readFile(path.join(backend.vault, 'host.md'), 'utf8')).toBe(host);
});

test('editing an embedded heading saves the actual target file and leaves the host bytes unchanged', async ({ page, backend }, info) => {
  const embed = page.locator('.workspace .cm-note-embed');
  await embed.getByRole('button', { name: '编辑嵌入', exact: true }).click();
  const editor = embed.locator('.cm-note-fragment .cm-content');
  await expect(editor).toBeEditable();
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('Embedded disk edit');
  await expect(editor).toContainText('Embedded disk edit');
  await expect.poll(() => fs.readFile(path.join(backend.vault, 'targets', 'first.md'), 'utf8'), { timeout: 15000 })
    .toBe(target + 'Embedded disk edit');
  await embed.getByRole('button', { name: '完成', exact: true }).click();
  await expect(embed).toContainText('Embedded disk edit');
  await expect(embed.locator('.cm-leading-heading')).toBeVisible();
  await expect(embed.locator('.cm-leading-heading')).toContainText('Same');
  await expect(page.locator('.workspace .cm-footnote-entry')).toHaveCount(0);
  await expect(page.locator('.workspace .cm-footnote-reference')).toHaveCount(0);
  expect(await fs.readFile(path.join(backend.vault, 'host.md'), 'utf8')).toBe(host);
  expect(await fs.readFile(path.join(backend.vault, 'targets', 'second.md'), 'utf8')).toBe(other);
  await page.screenshot({ path: info.outputPath('embedded-target-saved.png') });
  await page.reload();
  await page.waitForFunction(() => !!window.renderHarness);
  await page.evaluate(() => window.renderHarness.workspace('host.md'));
  await expect(page.locator('.workspace .cm-note-embed')).toContainText('Embedded disk edit');
  await expect(page.locator('.workspace .cm-note-embed .cm-leading-heading')).toBeVisible();
  await expect(page.locator('.workspace .cm-footnote-entry')).toHaveCount(0);
  await expect(page.locator('.workspace .cm-footnote-reference')).toHaveCount(0);
  expect(await fs.readFile(path.join(backend.vault, 'host.md'), 'utf8')).toBe(host);
});

test('global links and embeds create no phantom footnotes while a real saved footnote still renders', async ({ page, backend }) => {
  const saved = host + '\n\nGenuine reference[^real]\n\n[^real]: Genuine footnote body';
  await page.evaluate(async saved => {
    const modulePath = '/src/lib/documents.ts';
    const { documents } = await import(modulePath);
    const session = documents.get('host.md')!;
    session.setRawText(saved);
    await session.save();
  }, saved);
  await expect(page.locator('.workspace .cm-footnote-entry')).toHaveCount(1);
  await expect(page.locator('.workspace .cm-footnote-reference')).toHaveCount(1);
  await expect(page.locator('.workspace .cm-footnote-entry')).toContainText('Genuine footnote body');
  await expect(page.locator('.workspace')).not.toContainText('未找到脚注定义');
  await expect(page.locator('.workspace .cm-note-embed')).toContainText('Target original body');
  expect(await fs.readFile(path.join(backend.vault, 'host.md'), 'utf8')).toBe(saved);
  expect(await fs.readFile(path.join(backend.vault, 'targets', 'first.md'), 'utf8')).toBe(target);
});
