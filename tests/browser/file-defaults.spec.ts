import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let directory: string, vault: string, backend: string, child: ChildProcess;
let requests: Set<Promise<void>>;
const body = '# original\n\n正文保持不变。\n';
test.beforeEach(async ({ page }) => {
  requests = new Set();
  test.setTimeout(60000);
  const temporary = path.join(os.tmpdir(), '.agents');
  await fs.mkdir(temporary, { recursive: true });
  directory = await fs.mkdtemp(path.join(temporary, 'file-defaults-browser-'));
  vault = path.join(directory, 'vault');
  const data = path.join(directory, 'data');
  await fs.mkdir(path.join(vault, 'Notes'), { recursive: true }); await fs.mkdir(data);
  await fs.writeFile(path.join(vault, 'Notes/original.md'), body);
  await fs.writeFile(path.join(vault, 'Notes/taken.md'), 'existing target');
  await fs.writeFile(path.join(data, 'uistate.json'), JSON.stringify({ tabs: [{ path: 'Notes/original.md', title: 'Notes/original.md' }], activePath: 'Notes/original.md' }));
  child = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
    cwd: process.cwd(), windowsHide: true,
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1', DATA_DIR: data, VAULT_PATH: vault,
      ALLOWED_ROOTS: directory, WEBOBSIDIAN_INITIAL_VAULT: '', NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout!.on('data', chunk => { logs += chunk.toString(); });
  child.stderr!.on('data', chunk => { logs += chunk.toString(); });
  await expect.poll(async () => {
    if (child.exitCode !== null) throw new Error(logs);
    return fs.readFile(path.join(data, 'operations-endpoint.json'), 'utf8').then(text => JSON.parse(text).url, () => '');
  }, { timeout: 20000 }).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  backend = JSON.parse(await fs.readFile(path.join(data, 'operations-endpoint.json'), 'utf8')).url;
  await page.route('**/api/**', route => {
    const task = (async () => {
      const url = new URL(route.request().url());
      const response = await route.fetch({ url: backend + url.pathname + url.search });
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
    const entry = '/@fs/' + path.resolve('tests/browser/appearanceFixture.tsx').replaceAll('\\', '/');
    await route.fulfill({ response, body: (await response.text()).replace('/src/main.tsx', entry) });
  });
  await page.goto('/');
  await expect(page.locator('.main-pane .cm-content')).toContainText('正文保持不变');
});
test.afterEach(async ({ page }) => {
  // Close the real workspace before stopping its backend, avoiding late saves.
  try {
    const entry = '/@fs/' + path.resolve('tests/browser/appearanceFixture.tsx').replaceAll('\\', '/');
    if (!page.isClosed()) await page.evaluate(async entry => {
      const storePath = '/src/lib/store.ts';
      const { flushWorkspaceState } = await import(storePath);
      await flushWorkspaceState(); const { dispose } = await import(entry); dispose(); await flushWorkspaceState();
    }, entry);
  } finally {
    await page.close();
    await Promise.all([...requests]);
    if (child?.exitCode === null) {
      const closed = new Promise<void>(resolve => child.once('close', () => resolve()));
      child.kill(); await closed;
    }
    const prefix = path.join(os.tmpdir(), '.agents', 'file-defaults-browser-');
    if (directory && path.resolve(directory).startsWith(prefix)) await fs.rm(directory, { recursive: true, force: true });
  }
});

test('settings persist and default creation respects explicit folder choices', async ({ page }) => {
  await page.evaluate(async () => {
    const name = '/src/lib/store.ts'; const { useStore } = await import(name);
    useStore.getState().setSettings(true);
  });
  await page.getByRole('combobox', { name: '新建文件的默认位置', exact: true }).selectOption('folder');
  await page.getByRole('combobox', { name: '新建文件夹路径', exact: true }).fill('Inbox/Nested');
  await page.getByRole('combobox', { name: '附件的默认位置', exact: true }).selectOption('subfolder');
  await page.getByRole('combobox', { name: '附件文件夹路径', exact: true }).fill('assets');
  await page.getByRole('button', { name: '保存默认位置', exact: true }).click();
  await expect.poll(() => page.evaluate(async () => (await (await fetch('/api/settings')).json()).vault.newFileFolder)).toBe('Inbox/Nested');
  await page.screenshot({ path: test.info().outputPath('default-locations.png') });
  await page.getByRole('button', { name: '关闭设置' }).click();
  const created = await page.evaluate(async () => {
    const name = '/src/lib/store.ts'; const { useStore } = await import(name);
    await useStore.getState().newNote(); const first = useStore.getState().activePath;
    await useStore.getState().newNote(); const second = useStore.getState().activePath;
    await useStore.getState().newNote('Notes');
    return [first, second, useStore.getState().activePath];
  });
  expect(created).toEqual(['Inbox/Nested/Untitled.md', 'Inbox/Nested/Untitled 1.md', 'Notes/Untitled.md']);
  for (const file of created) expect(await fs.stat(path.join(vault, file!)).then(stat => stat.isFile())).toBe(true);
  await page.reload();
  const preferences = await page.evaluate(async () => (await (await fetch('/api/settings')).json()).vault);
  expect(preferences).toMatchObject({ newFileLocation: 'folder', newFileFolder: 'Inbox/Nested', attachmentLocation: 'subfolder', attachmentDir: 'assets' });
  await page.evaluate(async () => {
    const apiPath = '/src/lib/api.ts', storePath = '/src/lib/store.ts';
    const { api } = await import(apiPath), { useStore } = await import(storePath);
    await api.putSettings({ vault: { newFileLocation: 'current' } });
    await useStore.getState().openFile('Notes/original.md'); await useStore.getState().newNote();
  });
  await expect(page.locator('.main-pane [data-document-id]')).toHaveAttribute('data-document-id', 'Notes/Untitled 1.md');
  await page.evaluate(async () => {
    const name = '/src/lib/store.ts'; const { useStore } = await import(name);
    await useStore.getState().openFile('Notes'); await useStore.getState().newNote();
  });
  await expect(page.locator('.main-pane [data-document-id]')).toHaveAttribute('data-document-id', 'Notes/Untitled 2.md');
  await page.evaluate(async () => {
    const name = '/src/lib/store.ts'; const { useStore } = await import(name);
    await useStore.getState().openWikilink('Linked note', 'Notes/original.md');
  });
  await expect(page.locator('.main-pane [data-document-id]')).toHaveAttribute('data-document-id', 'Notes/Linked note.md');
  await page.evaluate(async () => {
    const name = '/src/lib/store.ts'; const { useStore } = await import(name);
    await useStore.getState().openHomepage(); await useStore.getState().newNote();
  });
  await expect(page.locator('.main-pane [data-document-id]')).toHaveAttribute('data-document-id', 'Untitled.md');
});

test('attachment destinations use note context, existing case and explicit overrides', async ({ page }) => {
  await fs.mkdir(path.join(vault, 'Attachments'));
  const paths = await page.evaluate(async () => {
    const name = '/src/lib/api.ts'; const { api } = await import(name);
    const upload = async (filename: string, dir?: string) => (await api.upload(new File(['payload'], filename), dir, 'Notes/original.md')).path;
    const paths = [await upload('default.txt')];
    for (const attachmentLocation of ['root', 'current', 'subfolder', 'folder']) {
      await api.putSettings({ vault: { attachmentLocation, attachmentDir: 'assets' } });
      paths.push(await upload(attachmentLocation + '.txt'));
    }
    paths.push(await upload('explicit.txt', 'Chosen'));
    return paths;
  });
  expect(paths).toEqual(['Attachments/default.txt', 'root.txt', 'Notes/current.txt', 'Notes/assets/subfolder.txt', 'assets/folder.txt', 'Chosen/explicit.txt']);
  for (const file of paths) expect(await fs.readFile(path.join(vault, file), 'utf8')).toBe('payload');
  const invalid = await page.evaluate(async () => {
    const name = '/src/lib/api.ts'; const { api } = await import(name);
    try { await api.putSettings({ vault: { attachmentDir: '../outside' } }); return false; } catch { return true; }
  });
  expect(invalid).toBe(true);
});

test('inline title renames in all modes and preserves draft and undo history', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const title = () => page.getByRole('textbox', { name: '笔记标题', exact: true });
  // This fixture starts with a matching H1: the editable filename must remain visible.
  await expect(title()).toHaveText('original');
  const editor = page.locator('.main-pane .cm-content');
  await editor.click(); await page.keyboard.press('Control+End'); await page.keyboard.type(' draft');
  await title().fill('renamed'); await title().press('Enter');
  await expect(page.locator('.main-pane [data-document-id]')).toHaveAttribute('data-document-id', 'Notes/renamed.md');
  await expect(editor).toContainText('draft');
  await editor.click(); await page.keyboard.press('Control+z');
  await expect(editor).not.toContainText('draft');
  expect(await fs.readFile(path.join(vault, 'Notes/renamed.md'), 'utf8')).toContain('# original');
  expect(await fs.access(path.join(vault, 'Notes/original.md')).then(() => true, () => false)).toBe(false);
  for (const mode of ['reading', 'source', 'live']) {
    await page.evaluate(async mode => { const name = '/src/lib/store.ts'; const { useStore } = await import(name); useStore.getState().setViewMode(mode); }, mode);
    await title().fill(mode); await title().press('Enter');
    await expect(title()).toHaveText(mode);
    await expect(page.locator('.main-pane [data-document-id]')).toHaveAttribute('data-document-id', `Notes/${mode}.md`);
  }
  await title().fill('canceled'); await title().press('Escape'); await expect(title()).toHaveText('live');
  await title().fill('taken'); await title().press('Enter'); await expect(title()).toHaveText('live');
  expect(await fs.readFile(path.join(vault, 'Notes/taken.md'), 'utf8')).toBe('existing target');
  await title().fill('bad/name'); await title().press('Enter'); await expect(title()).toHaveText('live');
  await title().fill(''); await title().press('Enter'); await expect(title()).toHaveText('live');
  // Native restarts restore the flushed workspace; there is no note URL to reload.
  await page.evaluate(async () => { const name = '/src/lib/store.ts'; const { flushWorkspaceState } = await import(name); await flushWorkspaceState(); });
  await page.reload(); await expect(title()).toHaveText('live');
  await title().focus(); await page.screenshot({ path: test.info().outputPath('inline-title.png') });
  expect(errors).toEqual([]);
});

test('pasted images retain every attachment and leave the other split unchanged', async ({ page }) => {
  await page.evaluate(async () => {
    const apiPath = '/src/lib/api.ts', storePath = '/src/lib/store.ts';
    const { api } = await import(apiPath), { useStore } = await import(storePath);
    await api.putSettings({ vault: { attachmentLocation: 'subfolder', attachmentDir: 'assets' } });
    await useStore.getState().openToSide('Notes/taken.md', 'right');
  });
  await expect(page.locator('.split-pane .cm-content')).toContainText('existing target');
  await page.locator('.main-pane .cm-content').evaluate(element => {
    const data = new DataTransfer();
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII='), character => character.charCodeAt(0));
    data.items.add(new File([png], 'first.png', { type: 'image/png' }));
    data.items.add(new File([png], 'second.png', { type: 'image/png' }));
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect.poll(() => fs.readFile(path.join(vault, 'Notes/original.md'), 'utf8')).toContain('Notes/assets/second.png');
  // Raw clipboard bitmaps all arrive as image.png; neither paste may replace the other.
  for (let round = 0; round < 2; round++) await page.locator('.main-pane .cm-content').evaluate(element => {
    const data = new DataTransfer();
    data.items.add(new File([Uint8Array.from([137, 80, 78, 71])], 'image.png', { type: 'image/png' }));
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect.poll(async () => (await fs.readdir(path.join(vault, 'Notes/assets'))).filter(name => name.startsWith('Pasted image ')).length).toBe(2);
  await expect.poll(() => fs.readFile(path.join(vault, 'Notes/original.md'), 'utf8')).toContain('Notes/assets/second.png');
  const text = await fs.readFile(path.join(vault, 'Notes/original.md'), 'utf8');
  expect(text).toContain('Notes/assets/first.png'); expect(text).toContain('正文保持不变');
  expect(await fs.readFile(path.join(vault, 'Notes/taken.md'), 'utf8')).toBe('existing target');
  for (const file of ['first.png', 'second.png']) expect((await fs.stat(path.join(vault, 'Notes/assets', file))).size).toBeGreaterThan(0);
});
