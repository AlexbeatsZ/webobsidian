import { test as base, expect } from './test';
import type { Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const source = '---\ntopic: Appearance\n---\n\n## 正文标题\n\n正文与公式 $x^2+1$ 同步缩放。\n\n$$\n' +
  'x+'.repeat(100) + 'x\\tag{Long}\n$$\n\nend';

interface Backend {
  directory: string;
  vault: string;
  data: string;
  url: string;
  process: ChildProcess;
}

const test = base.extend<{ backend: Backend }>({
  backend: async ({}, use, info) => {
    const temporary = path.join(os.tmpdir(), '.agents');
    await fs.mkdir(temporary, { recursive: true });
    const directory = await fs.mkdtemp(path.join(temporary, 'appearance-browser-'));
    const vault = path.join(directory, 'vault'), data = path.join(directory, 'data');
    await fs.mkdir(vault); await fs.mkdir(data);
    await fs.writeFile(path.join(vault, 'appearance.md'), source);
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
      const url = JSON.parse(await fs.readFile(endpoint, 'utf8')).url;
      await use({ directory, vault, data, url, process: child });
    } finally {
      if (child.exitCode === null) {
        const closed = new Promise<void>(resolve => child.once('close', () => resolve()));
        child.kill(); await closed;
      }
      await fs.mkdir(path.dirname(info.outputPath('server.log')), { recursive: true });
      await fs.writeFile(info.outputPath('server.log'), logs);
      const prefix = path.join(os.tmpdir(), '.agents', 'appearance-browser-');
      if (!path.resolve(directory).startsWith(prefix)) throw new Error('Unexpected browser fixture directory');
      await fs.rm(directory, { recursive: true, force: true });
    }
  },
});

test.beforeEach(async ({ page, backend }) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 2200, height: 1100 });
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: backend.url + url.pathname + url.search });
    await route.fulfill({ response });
  });
  await page.routeWebSocket('**/ws', () => {});
  await page.routeWebSocket(url => url.searchParams.has('token'), socket => socket.send(JSON.stringify({ type: 'connected' })));
  await page.route('**/note/appearance.md', async route => {
    if (route.request().resourceType() !== 'document') return route.fallback();
    const response = await route.fetch();
    const entry = '/@fs/' + path.resolve('tests/browser/appearanceFixture.tsx').replaceAll('\\', '/');
    await route.fulfill({ response, body: (await response.text()).replace('/src/main.tsx', entry) });
  });
  await page.goto('/note/appearance.md');
  await expect(page.locator('.main-pane .cm-content')).toContainText('end');
  await page.evaluate(async () => {
    const modulePath = '/src/lib/store.ts';
    const { useStore } = await import(modulePath);
    await useStore.getState().openToSide('appearance.md', 'right');
  });
  await expect(page.locator('.split-pane .cm-content')).toContainText('end');
  await expect(page.locator('[data-render-pending]')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
});

test.afterEach(async ({ page }) => {
  if (page.isClosed()) return;
  const entry = '/@fs/' + path.resolve('tests/browser/appearanceFixture.tsx').replaceAll('\\', '/');
  await page.evaluate(async entry => {
    const storePath = '/src/lib/store.ts';
    const { flushWorkspaceState } = await import(storePath);
    await flushWorkspaceState();
    const { dispose } = await import(entry);
    dispose();
    await flushWorkspaceState();
  }, entry);
});

async function openAppearance(page: Page) {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '外观', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: '正文字号', exact: true })).toBeVisible();
}

async function change(page: Page, field: 'size' | 'width', value: string) {
  await page.getByRole('spinbutton', { name: field === 'size' ? '正文字号' : '正文列宽（含左右边距）', exact: true }).fill(value);
  await expect(page.locator('.settings-content [role="status"]')).toHaveText('已保存');
}

async function geometry(page: Page) {
  return page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.workspace .markdown-source-view')].map(host => {
    const content = host.querySelector<HTMLElement>('.cm-content')!, style = getComputedStyle(content);
    const inline = host.querySelector<HTMLElement>('.math-inline svg');
    const body = host.querySelector<HTMLElement>('.math-block .cm-math-body');
    const scroller = host.querySelector<HTMLElement>('.cm-scroller')!;
    const title = host.querySelector<HTMLElement>('.cm-inline-title')!;
    const rectangle = content.getBoundingClientRect(), hostRectangle = host.getBoundingClientRect();
    const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    return {
      mode: host.dataset.mode, fontSize: parseFloat(style.fontSize), width: rectangle.width, net: rectangle.width - padding,
      padding, left: rectangle.left - hostRectangle.left, right: hostRectangle.right - rectangle.right,
      hostWidth: hostRectangle.width, titleSize: parseFloat(getComputedStyle(title).fontSize),
      headingSize: parseFloat(getComputedStyle(host.querySelector('.HyperMD-header-2')!).fontSize),
      propertiesSize: getComputedStyle(host.querySelector('.prop-row')!).fontSize,
      inlineHeight: inline?.getBoundingClientRect().height, inlineWidth: inline?.getBoundingClientRect().width,
      mathWidth: body?.clientWidth, mathScrollWidth: body?.scrollWidth,
      scrollWidth: scroller.scrollWidth, scrollClientWidth: scroller.clientWidth, scrollOverflow: getComputedStyle(scroller).overflowX,
      bodyScrollWidth: document.body.scrollWidth, viewport: innerWidth,
    };
  }));
}

test('real Appearance entry updates both mounted modes, title and formulas without changing UI typography', async ({ page, backend }, info) => {
  const before = await geometry(page);
  for (const view of before) {
    expect(view.fontSize).toBe(18); expect(view.width).toBe(700); expect(view.net).toBe(636);
    expect(view.titleSize).toBeCloseTo(18 * 1.618, 2);
  }
  const uiSize = await page.locator('.status-bar').evaluate(element => getComputedStyle(element).fontSize);
  await openAppearance(page);
  await expect(page.getByRole('group', { name: '正文列宽（含左右边距）', exact: true })).toContainText('636 px');
  await change(page, 'size', '24'); await change(page, 'width', '900');
  await page.getByRole('button', { name: '关闭设置' }).click();
  await expect.poll(async () => (await geometry(page)).every(view => view.fontSize === 24 && view.width === 900)).toBe(true);
  await expect(page.locator('[data-render-pending]')).toHaveCount(0);
  const after = await geometry(page);
  for (const [index, view] of after.entries()) {
    expect(view.net).toBe(836); expect(view.titleSize).toBeCloseTo(24 * 1.618, 2);
    expect(view.headingSize / before[index].headingSize).toBeCloseTo(24 / 18, 2);
    expect(view.propertiesSize).toBe(before[index].propertiesSize);
    expect(view.inlineHeight! / before[index].inlineHeight!).toBeCloseTo(24 / 18, 1);
    expect(view.scrollWidth).toBeGreaterThan(view.scrollClientWidth);
    expect(Math.abs(view.left - view.right)).toBeLessThan(1);
  }
  expect(after[0].width).toBe(after[1].width);
  expect(after[0].inlineHeight).toBeCloseTo(after[1].inlineHeight!, 2);
  expect(await page.locator('.status-bar').evaluate(element => getComputedStyle(element).fontSize)).toBe(uiSize);
  expect(await fs.readFile(path.join(backend.vault, 'appearance.md'), 'utf8')).toBe(source);
  await info.attach('geometry', { body: JSON.stringify({ before, after }, null, 2), contentType: 'application/json' });
  await fs.writeFile(info.outputPath('geometry.json'), JSON.stringify({ before, after }, null, 2));
  await page.screenshot({ path: info.outputPath('appearance-both-modes.png') });
});

test('appearance persists to the real settings file, survives reload and resets through the UI', async ({ page, backend }, info) => {
  await openAppearance(page);
  await change(page, 'size', '26'); await change(page, 'width', '1024');
  await page.getByRole('combobox', { name: '基础颜色' }).selectOption('obsidian-dark');
  await expect(page.locator('.settings-content [role="status"]')).toHaveText('已保存');
  const persisted = JSON.parse(await fs.readFile(path.join(backend.data, 'settings.json'), 'utf8'));
  expect(persisted.ui).toMatchObject({ fontTextSize: 26, fileLineWidth: 1024, theme: 'obsidian-dark', defaultView: 'live' });
  await page.getByRole('button', { name: '关闭设置' }).click();
  await page.evaluate(async () => {
    const modulePath = '/src/lib/store.ts';
    const { flushWorkspaceState } = await import(modulePath);
    await flushWorkspaceState();
  });
  await page.reload();
  await expect(page.locator('.main-pane .cm-content')).toHaveCSS('font-size', '26px');
  await expect(page.locator('body')).toHaveClass(/theme-dark/);
  await openAppearance(page);
  await expect(page.getByRole('spinbutton', { name: '正文字号', exact: true })).toHaveValue('26');
  await expect(page.getByRole('spinbutton', { name: '正文列宽（含左右边距）', exact: true })).toHaveValue('1024');
  await page.screenshot({ path: info.outputPath('appearance-saved-reloaded.png') });
  await page.getByRole('button', { name: '恢复默认', exact: true }).click();
  await expect(page.locator('.settings-content [role="status"]')).toHaveText('已保存');
  await expect(page.getByRole('spinbutton', { name: '正文字号', exact: true })).toHaveValue('18');
  const reset = JSON.parse(await fs.readFile(path.join(backend.data, 'settings.json'), 'utf8'));
  expect(reset.ui).toMatchObject({ fontTextSize: 18, fileLineWidth: 700, theme: 'obsidian-dark' });
  expect(reset.vault).toEqual(persisted.vault); expect(reset.search).toEqual(persisted.search);
});

test('numeric boundaries reject invalid drafts and direct API values without persisting them', async ({ page, backend }) => {
  await openAppearance(page);
  const filename = path.join(backend.data, 'settings.json');
  const original = await fs.readFile(filename, 'utf8');
  let writes = 0;
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/settings/' && request.method() === 'PUT') writes++; });
  for (const [field, value] of [['size', ''], ['size', '11'], ['size', '37'], ['size', '18.5'], ['width', '319'], ['width', '2001'], ['width', '700.5']] as const) {
    await page.getByRole('spinbutton', { name: field === 'size' ? '正文字号' : '正文列宽（含左右边距）', exact: true }).fill(value);
    await expect(page.locator('.settings-content [role="alert"]')).toContainText('整数');
    await expect(page.locator('.main-pane .cm-content')).toHaveCSS('font-size', '18px');
  }
  expect(writes).toBe(0); expect(await fs.readFile(filename, 'utf8')).toBe(original);
  const identity = await (await fetch(backend.url + '/api/vault-identity')).json();
  for (const patch of [{ fontTextSize: 37 }, { fontTextSize: '24' }, { fileLineWidth: 319 }, { fileLineWidth: null }, { fileLineWidth: 900.5 }]) {
    const response = await fetch(backend.url + '/api/settings/', { method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Vault-Identity': identity.vault }, body: JSON.stringify({ ui: patch }) });
    expect(response.status).toBe(400);
  }
  expect(await fs.readFile(filename, 'utf8')).toBe(original);
  for (const value of ['12', '36']) await change(page, 'size', value);
  for (const value of ['320', '2000']) await change(page, 'width', value);
  const persisted = JSON.parse(await fs.readFile(filename, 'utf8'));
  expect(persisted.ui).toMatchObject({ fontTextSize: 36, fileLineWidth: 2000 });
});

test('narrow windows adapt both modes and retain horizontal scrolling inside long formulas', async ({ page }, info) => {
  await openAppearance(page); await change(page, 'size', '30'); await change(page, 'width', '2000');
  await page.getByRole('button', { name: '关闭设置' }).click();
  await page.evaluate(async () => {
    const modulePath = '/src/lib/store.ts';
    const { useStore } = await import(modulePath);
    await useStore.getState().openToSide('appearance.md', 'down');
  });
  await page.getByRole('button', { name: '折叠/展开左侧边栏' }).click();
  await page.getByRole('button', { name: '折叠/展开右侧边栏' }).click();
  await page.setViewportSize({ width: 390, height: 900 });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await info.attach('initial-narrow-geometry', { body: JSON.stringify(await geometry(page), null, 2), contentType: 'application/json' });
  await expect.poll(async () => (await geometry(page)).every(view => view.hostWidth <= 390 && view.width <= view.hostWidth)).toBe(true);
  await expect(page.locator('[data-render-pending]')).toHaveCount(0);
  const views = await geometry(page);
  for (const view of views) {
    expect(view.width).toBeLessThanOrEqual(390); expect(view.left).toBeGreaterThanOrEqual(0); expect(view.right).toBeGreaterThanOrEqual(0);
    expect(view.bodyScrollWidth).toBeLessThanOrEqual(390); expect(view.scrollWidth).toBeGreaterThan(view.scrollClientWidth);
    expect(view.fontSize).toBe(30);
  }
  expect(views[0].width).toBe(views[1].width);
  const scrolled = await page.locator('.split-pane .cm-scroller').evaluate(element => {
    element.scrollLeft = 200; return element.scrollLeft;
  });
  expect(scrolled).toBeGreaterThan(0);
  await page.locator('.split-pane .cm-scroller').evaluate(element => { element.scrollLeft = 0; });
  await info.attach('narrow-geometry', { body: JSON.stringify(views, null, 2), contentType: 'application/json' });
  await fs.writeFile(info.outputPath('geometry.json'), JSON.stringify(views, null, 2));
  await page.screenshot({ path: info.outputPath('appearance-narrow.png') });
});

test('font, width and theme changes retain dirty source, editor identity and undo history', async ({ page, backend }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/files/content*', async route => {
    if (route.request().method() === 'PUT') await held;
    await route.fallback();
  });
  try {
    await page.locator('.main-pane .cm-content').click();
    await page.keyboard.press('Control+End'); await page.keyboard.type(' unsaved-appearance');
    await page.evaluate(() => {
      (window as any).appearanceEditor = document.querySelector('.main-pane .cm-content');
      (window as any).appearanceMarker = 'no-reload';
    });
    await openAppearance(page); await change(page, 'size', '25'); await change(page, 'width', '950');
    await page.getByRole('combobox', { name: '基础颜色' }).selectOption('obsidian-dark');
    await expect(page.locator('.settings-content [role="status"]')).toHaveText('已保存');
    await page.getByRole('button', { name: '关闭设置' }).click();
    await expect(page.locator('.main-pane .cm-content')).toContainText('unsaved-appearance');
    await expect(page.locator('.split-pane .cm-content')).toContainText('unsaved-appearance');
    expect(await page.evaluate(() => (window as any).appearanceMarker)).toBe('no-reload');
    expect(await page.evaluate(() => (window as any).appearanceEditor === document.querySelector('.main-pane .cm-content'))).toBe(true);
    const state = await page.evaluate(async () => {
      const modulePath = '/src/lib/documents.ts';
      const { documents } = await import(modulePath);
      return documents.get('appearance.md')!.snapshot;
    });
    expect(state.dirty).toBe(true); expect(state.raw).toContain('unsaved-appearance');
    expect(await fs.readFile(path.join(backend.vault, 'appearance.md'), 'utf8')).toBe(source);
    await page.locator('.main-pane .cm-content').click(); await page.keyboard.press('Control+z');
    await expect(page.locator('.main-pane .cm-content')).not.toContainText('unsaved-appearance');
  } finally { release(); }
});

test('rapid changes serialize a delayed old response and publish the final value in both views', async ({ page, backend }) => {
  await openAppearance(page);
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const values: number[] = [];
  await page.route('**/api/settings/', async route => {
    if (route.request().method() !== 'PUT') return route.fallback();
    values.push(route.request().postDataJSON().ui.fontTextSize);
    const response = await route.fetch({ url: backend.url + '/api/settings/' });
    if (values.length === 1) { entered(); await held; }
    await route.fulfill({ response });
  });
  const input = page.getByRole('spinbutton', { name: '正文字号', exact: true });
  await input.fill('24'); await started; await input.fill('28');
  expect(values).toEqual([24]);
  await expect(input).toHaveValue('28');
  release();
  await expect(page.locator('.settings-content [role="status"]')).toHaveText('已保存');
  await expect.poll(() => values).toEqual([24, 28]);
  for (const pane of ['main-pane', 'split-pane']) await expect(page.locator(`.${pane} .cm-content`)).toHaveCSS('font-size', '28px');
  await expect(input).toHaveValue('28');
  expect(JSON.parse(await fs.readFile(path.join(backend.data, 'settings.json'), 'utf8')).ui.fontTextSize).toBe(28);
  await page.getByRole('button', { name: '关闭设置' }).click(); await openAppearance(page);
  await expect(input).toHaveValue('28');
});

test.describe('controlled settings failure', () => {
  test.use({ expectedErrors: ['507'] });

  test('failed save retains the last applied width, shows feedback and permits retry', async ({ page, backend }, info) => {
    await openAppearance(page); await change(page, 'width', '900');
    let fail = true;
    await page.route('**/api/settings/', route => {
      if (route.request().method() === 'PUT' && fail) {
        fail = false; return route.fulfill({ status: 507, json: { error: 'controlled appearance disk failure' } });
      }
      return route.fallback();
    });
    await page.getByRole('spinbutton', { name: '正文列宽（含左右边距）', exact: true }).fill('1200');
    await expect(page.getByRole('alert')).toContainText('保存失败');
    await expect(page.getByRole('alert')).toContainText('controlled appearance disk failure');
    expect((await geometry(page)).map(view => view.width)).toEqual([900, 900]);
    expect(JSON.parse(await fs.readFile(path.join(backend.data, 'settings.json'), 'utf8')).ui.fileLineWidth).toBe(900);
    await page.screenshot({ path: info.outputPath('appearance-save-failure.png') });
    await change(page, 'width', '901');
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect((await geometry(page)).map(view => view.width)).toEqual([901, 901]);
  });

  test('rapid queued changes survive an earlier delayed failure without stale feedback', async ({ page, backend }) => {
    await openAppearance(page);
    let release!: () => void, entered!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    let writes = 0;
    await page.route('**/api/settings/', async route => {
      if (route.request().method() !== 'PUT') return route.fallback();
      writes++;
      if (writes === 1) {
        entered(); await held;
        return route.fulfill({ status: 507, json: { error: 'controlled delayed failure' } });
      }
      return route.fallback();
    });
    const input = page.getByRole('spinbutton', { name: '正文字号', exact: true });
    await input.fill('24'); await started; await input.fill('29'); expect(writes).toBe(1);
    release();
    await expect(page.locator('.settings-content [role="status"]')).toHaveText('已保存');
    await expect(page.getByRole('alert')).toHaveCount(0); await expect(input).toHaveValue('29');
    for (const pane of ['main-pane', 'split-pane']) await expect(page.locator(`.${pane} .cm-content`)).toHaveCSS('font-size', '29px');
    expect(JSON.parse(await fs.readFile(path.join(backend.data, 'settings.json'), 'utf8')).ui.fontTextSize).toBe(29);
  });
});
