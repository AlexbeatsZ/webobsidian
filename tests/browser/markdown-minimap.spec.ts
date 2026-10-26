import { test, expect } from './test';

const source = ['# First heading', '', ...Array.from({ length: 1200 }, (_, index) =>
  index % 40 === 0 ? `## Heading ${index}\nneedle ${index}` : `Paragraph ${index} with text content.`), '', '# Last heading'].join('\n');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const records: { observer: ResizeObserver; targets: Set<Element>; observes: Element[]; unobserves: Element[]; disconnects: number }[] = [];
    const nativeObserve = ResizeObserver.prototype.observe;
    const nativeUnobserve = ResizeObserver.prototype.unobserve;
    const nativeDisconnect = ResizeObserver.prototype.disconnect;
    const record = (observer: ResizeObserver) => {
      let entry = records.find(entry => entry.observer === observer);
      if (!entry) records.push(entry = { observer, targets: new Set(), observes: [], unobserves: [], disconnects: 0 });
      return entry;
    };
    ResizeObserver.prototype.observe = function(target, options) {
      const entry = record(this);
      entry.targets.add(target); entry.observes.push(target);
      return nativeObserve.call(this, target, options);
    };
    ResizeObserver.prototype.unobserve = function(target) {
      const entry = record(this);
      entry.targets.delete(target); entry.unobserves.push(target);
      return nativeUnobserve.call(this, target);
    };
    ResizeObserver.prototype.disconnect = function() {
      const entry = record(this);
      entry.targets.clear(); entry.disconnects++;
      return nativeDisconnect.call(this);
    };
    (window as any).minimapObservers = records;
  });
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (['/api/vault-identity', '/api/writing'].includes(url.pathname)) return route.fallback();
    if (url.pathname.replace(/\/$/, '') === '/api/uistate') return route.fulfill({ json: route.request().method() === 'PUT' ? { ok: true }
      : { rightPanel: 'minimap', activePath: 'a.md', tabs: [{ path: 'a.md' }], viewMode: 'source' } });
    if (url.pathname === '/api/files/content') {
      const path = url.searchParams.get('path');
      return route.fulfill({ json: { path, content: path === 'a.md' ? source : '# Other note\n\nOther text.', revision: 'initial', vault: 'browser-fixture' } });
    }
    if (url.pathname === '/api/property-types') return route.fulfill({ json: { types: {} } });
    return route.fulfill({ json: { hits: [], matches: [], backlinks: [], enabled: false } });
  });
  await page.goto('/__render-test');
  await page.waitForFunction(() => Boolean(window.renderHarness));
  await page.evaluate(async () => {
    const load = (path: string) => import(path);
    const [store, navigation, documents, search] = await Promise.all([
      load('/src/lib/store.ts'), load('/src/lib/fragmentNavigation.ts'), load('/src/lib/documents.ts'),
      load('/src/lib/search.ts'),
    ]);
    (window as any).minimapFixture = { store: store.useStore, navigation, documents: documents.documents, search };
    await window.renderHarness.workspace('a.md');
    store.useStore.getState().setViewMode('source');
    store.useStore.getState().setRightPanel('minimap');
  });
  await expect(page.locator('.markdown-minimap')).toHaveAttribute('data-ready', 'true');
  await expect.poll(() => page.locator('.markdown-minimap canvas').getAttribute('data-paint-count')).not.toBeNull();
  await expect(page.locator('.markdown-minimap-description')).toHaveCount(0);
  await expect(page.getByRole('slider', { name: '文档缩略图位置' })).toBeVisible();
});

test('repaints retain media subscriptions and removed targets and closed panels release their observers', async ({ page }) => {
  await page.evaluate(() => {
    const fixture = (window as any).minimapFixture;
    fixture.documents.get('a.md').setRawText('# Table\n\n| first | second |\n| --- | --- |\n| value | value |\n\nend');
    fixture.store.getState().setViewMode('live');
  });
  await expect(page.locator('.cm-table')).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const table = document.querySelector('.cm-content table');
    const record = (window as any).minimapObservers.find((entry: any) => entry.targets.has(table));
    if (!record) return false;
    (window as any).minimapFixture.mediaRecord = record;
    (window as any).minimapFixture.table = table;
    return true;
  })).toBe(true);
  const image = page.locator('.markdown-minimap canvas');
  const before = await page.evaluate(() => {
    const record = (window as any).minimapFixture.mediaRecord;
    return { observes: record.observes.length, disconnects: record.disconnects };
  });
  for (const color of ['red', 'blue', 'green']) {
    const paints = Number(await image.getAttribute('data-paint-count'));
    await page.evaluate(color => document.body.style.setProperty('--minimap-match', color), color);
    await expect.poll(async () => Number(await image.getAttribute('data-paint-count'))).toBeGreaterThan(paints);
  }
  expect(await page.evaluate(() => {
    const record = (window as any).minimapFixture.mediaRecord;
    return { observes: record.observes.length, disconnects: record.disconnects };
  })).toEqual(before);
  await page.evaluate(() => (window as any).minimapFixture.documents.get('a.md').setRawText('# No media\n\nordinary text'));
  await expect.poll(() => page.evaluate(() => {
    const fixture = (window as any).minimapFixture;
    return { observed: fixture.mediaRecord.targets.has(fixture.table),
      removed: fixture.mediaRecord.unobserves.includes(fixture.table),
      connected: [...fixture.mediaRecord.targets].every((target: any) => target.isConnected) };
  })).toEqual({ observed: false, removed: true, connected: true });
  await page.evaluate(() => (window as any).minimapFixture.store.getState().setRightPanel('outline'));
  await expect(image).toHaveCount(0);
  expect(await page.evaluate(() => {
    const record = (window as any).minimapFixture.mediaRecord;
    return { targets: record.targets.size, disconnects: record.disconnects };
  })).toEqual({ targets: 0, disconnects: before.disconnects + 1 });
});

test('virtual scrolling discovers mounted overflow, releases unmounted media and keeps ordinary scrolls paint-free', async ({ page }) => {
  await page.evaluate(() => {
    const fixture = (window as any).minimapFixture;
    const headers = Array.from({ length: 24 }, (_, index) => `LongHeader${index}Text`);
    const table = [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`,
      `| ${headers.map(() => 'value').join(' | ')} |`].join('\n');
    fixture.documents.get('a.md').setRawText('# Start\n\n' + 'ordinary text\n\n'.repeat(500) + table + '\n\n' + 'tail\n\n'.repeat(500));
    fixture.store.getState().setViewMode('reading');
  });
  const image = page.locator('.markdown-minimap canvas');
  await expect(page.locator('.cm-content table')).toHaveCount(0);
  await expect.poll(async () => Number(await image.getAttribute('data-source-width'))).toBeLessThan(900);
  const ordinaryWidth = Number(await image.getAttribute('data-source-width'));
  const paints = Number(await image.getAttribute('data-paint-count'));
  await page.evaluate(() => {
    const fixture = (window as any).minimapFixture;
    fixture.navigation.navigationView('a.md', 'main').scrollDOM.scrollTop = 2000;
  });
  await expect.poll(() => page.getByRole('slider').getAttribute('aria-valuenow')).not.toBe('1');
  expect(await image.getAttribute('data-paint-count')).toBe(String(paints));
  await page.evaluate(async () => {
    const fixture = (window as any).minimapFixture;
    const view = fixture.navigation.navigationView('a.md', 'main');
    const line = view.state.doc.lineAt(view.state.doc.toString().indexOf('| LongHeader')).number - 1;
    await fixture.navigation.navigateTo('a.md', { line, viewId: 'main', focus: false, history: false, scrollOnly: true }, view);
  });
  await expect(page.locator('.cm-content table')).toBeVisible();
  await expect.poll(async () => Number(await image.getAttribute('data-source-width'))).toBeGreaterThan(ordinaryWidth + 100);
  await page.evaluate(() => {
    const fixture = (window as any).minimapFixture;
    fixture.mountedTable = document.querySelector('.cm-content table');
    fixture.mediaRecord = (window as any).minimapObservers.find((entry: any) => entry.targets.has(fixture.mountedTable));
    fixture.navigation.navigationView('a.md', 'main').scrollDOM.scrollTop = 0;
  });
  await expect(page.locator('.cm-content table')).toHaveCount(0);
  await expect.poll(async () => Number(await image.getAttribute('data-source-width'))).toBe(ordinaryWidth);
  expect(await page.evaluate(() => {
    const fixture = (window as any).minimapFixture;
    return { removed: fixture.mediaRecord.unobserves.includes(fixture.mountedTable), observed: fixture.mediaRecord.targets.has(fixture.mountedTable) };
  })).toEqual({ removed: true, observed: false });
});

test('layout measures one border box and ignores height-only resizes and disposed media', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const load = (path: string) => import(path);
    const { observeMinimapLayout } = await load('/src/lib/markdownMinimapLayout.ts');
    const scroll = document.createElement('div'), content = document.createElement('div');
    scroll.style.cssText = 'position:fixed;left:0;top:0;width:500px;height:100px;overflow:auto';
    content.style.cssText = 'box-sizing:border-box;width:400px;padding:16px;border:3px solid;height:300px';
    scroll.append(content); document.body.append(scroll);
    let callbacks = 0;
    const layout = observeMinimapLayout({ contentDOM: content, scrollDOM: scroll }, () => { callbacks++; });
    const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await settle();
    const first = { changed: layout.measure(), ...layout.width };
    content.style.height = '350px';
    await settle();
    const heightChanged = layout.measure();
    const media = document.createElement('img');
    media.style.cssText = 'display:block;width:900px;height:10px;max-width:none';
    content.append(media);
    await settle();
    const overflow = { changed: layout.measure(), ...layout.width };
    media.style.width = '1100px';
    await settle();
    const resized = { changed: layout.measure(), ...layout.width };
    media.remove();
    await settle();
    const restored = { changed: layout.measure(), ...layout.width };
    layout.dispose();
    const disposedCallbacks = callbacks;
    content.append(media); content.style.width = '420px'; scroll.scrollTop = 20;
    await settle();
    scroll.remove();
    return { first, heightChanged, overflow, resized, restored, disposedCallbacks, callbacks };
  });
  expect(result.first).toEqual({ changed: true, column: 400, source: 400 });
  expect(result.heightChanged).toBe(false);
  expect(result.overflow.changed).toBe(true);
  expect(result.overflow.source).toBeGreaterThan(900);
  expect(result.resized.source).toBeGreaterThan(result.overflow.source + 100);
  expect(result.restored).toEqual({ changed: true, column: 400, source: 400 });
  expect(result.callbacks).toBe(result.disposedCallbacks);
});

test('source width follows the document column, scales uniformly, and only grows for rendered overflow', async ({ page }) => {
  const image = page.locator('.markdown-minimap canvas');
  const measure = () => page.evaluate(() => {
    const fixture = (window as any).minimapFixture;
    const view = fixture.navigation.navigationView('a.md', 'main');
    const canvas = document.querySelector('.markdown-minimap canvas') as HTMLCanvasElement;
    return { column: view.contentDOM.getBoundingClientRect().width, source: Number(canvas.dataset.sourceWidth),
      backing: canvas.width, scale: Number(canvas.dataset.widthScale) };
  });
  const initial = await measure();
  expect(Math.abs(initial.source - initial.column)).toBeLessThanOrEqual(2);
  expect(initial.source).toBeGreaterThan(initial.backing + 100);
  expect(initial.scale).toBeGreaterThan(0.2);
  const firstPaint = Number(await image.getAttribute('data-paint-count'));
  await page.evaluate(() => document.body.style.setProperty('--file-line-width', '450px'));
  await expect.poll(async () => Number(await image.getAttribute('data-source-width'))).toBeLessThan(500);
  const narrowColumn = await measure();
  expect(Math.abs(narrowColumn.source - narrowColumn.column)).toBeLessThanOrEqual(2);
  const beforeFont = Number(await image.getAttribute('data-paint-count'));
  await page.evaluate(() => document.body.style.setProperty('--font-text-size', '26px'));
  await expect.poll(async () => Number(await image.getAttribute('data-paint-count'))).toBeGreaterThan(beforeFont);
  await page.evaluate(() => {
    const fixture = (window as any).minimapFixture;
    const headers = Array.from({ length: 24 }, (_, index) => `LongHeader${index}Text`);
    const table = [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`,
      `| ${headers.map(() => 'value').join(' | ')} |`].join('\n');
    fixture.documents.get('a.md').setRawText(`# Wide table\n\n${table}\n\nafter`);
    fixture.store.getState().setViewMode('live');
  });
  await expect(page.locator('.cm-table')).toBeVisible();
  await expect.poll(async () => Number(await image.getAttribute('data-source-width'))).toBeGreaterThan(900);
  const overflow = await measure();
  expect(overflow.source).toBeGreaterThan(overflow.column + 100);
  expect(overflow.scale).toBeLessThan(initial.scale);
  expect(overflow.scale).toBeGreaterThan(0);
  await page.evaluate(() => {
    const fixture = (window as any).minimapFixture;
    fixture.documents.get('a.md').setRawText('# Ordinary\n\n' + 'ordinary text\n'.repeat(120));
    fixture.store.getState().setViewMode('source');
  });
  await expect.poll(async () => Number(await image.getAttribute('data-source-width'))).toBeLessThan(500);
  expect(Number(await image.getAttribute('data-paint-count'))).toBeGreaterThan(firstPaint);
});

test('scroll changes only viewport, and click/drag target the main view without changing cursor, source or Undo', async ({ page }) => {
  await page.evaluate(() => {
    const fixture = (window as any).minimapFixture;
    fixture.store.setState({ splitPath: 'a.md' });
  });
  await expect(page.locator('[data-navigation-split] .cm-content')).toBeVisible();
  const before = await page.evaluate(async () => {
    const fixture = (window as any).minimapFixture;
    const main = fixture.navigation.navigationView('a.md', 'main');
    const split = fixture.navigation.navigationView('a.md', 'split');
    split.focus();
    main.dispatch({ selection: { anchor: 5 } });
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    fixture.main = main; fixture.split = split;
    return { cursor: main.state.selection.main.anchor, source: fixture.documents.get('a.md').snapshot.raw,
      splitScroll: split.scrollDOM.scrollTop, paints: document.querySelector('canvas[data-paint-count]')!.getAttribute('data-paint-count') };
  });
  await page.evaluate(() => {
    const fixture = (window as any).minimapFixture;
    fixture.main.scrollDOM.scrollTop = 2000;
  });
  await expect.poll(() => page.locator('.markdown-minimap-viewport').evaluate(element => element.getBoundingClientRect().top)).toBeGreaterThan(90);
  expect(await page.locator('.markdown-minimap canvas').getAttribute('data-paint-count')).toBe(before.paints);
  const map = page.locator('.markdown-minimap');
  const rect = (await map.boundingBox())!;
  await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height * 0.7);
  await expect.poll(() => page.evaluate(() => (window as any).minimapFixture.main.scrollDOM.scrollTop)).toBeGreaterThan(10000);
  const box = (await page.locator('.markdown-minimap-viewport').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height * 0.3, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => (window as any).minimapFixture.main.scrollDOM.scrollTop)).toBeLessThan(15000);
  expect(await page.evaluate(() => {
    const fixture = (window as any).minimapFixture;
    return { cursor: fixture.main.state.selection.main.anchor, source: fixture.documents.get('a.md').snapshot.raw,
      splitScroll: fixture.split.scrollDOM.scrollTop, undo: fixture.documents.get('a.md').undo() };
  })).toEqual({ cursor: before.cursor, source: before.source, splitScroll: before.splitScroll, undo: false });
});

test('CM regex and complete shared search results highlight, clear, and reject stale draft coordinates', async ({ page }) => {
  await page.locator('.workspace .cm-content').click();
  await page.keyboard.press('Control+f');
  await page.locator('.cm-search input[name="search"]').fill('needle \\d+');
  await page.locator('.cm-search input[name="re"]').check();
  await page.evaluate(() => {
    const fixture = (window as any).minimapFixture;
    const view = fixture.navigation.navigationView('a.md', 'main');
    const text = view.state.doc.toString();
    const sourceRanges = [...text.matchAll(/needle/g)].map(match => ({ from: match.index!, to: match.index! + 6, text: 'needle' }));
    fixture.search.publishSearchResultHighlights('needle', new Map([['a.md', { path: 'a.md', count: sourceRanges.length, contexts: [], sourceRanges }]]));
  });
  const image = page.locator('.markdown-minimap canvas');
  await expect(image).toHaveAttribute('data-marker-count', '30');
  await expect(image).toHaveAttribute('data-workspace-marker-count', '30');
  await page.evaluate(() => {
    const fixture = (window as any).minimapFixture, session = fixture.documents.get('a.md');
    const text = session.snapshot.text, from = text.indexOf('needle');
    session.edit(session.snapshot.version, [{ from, to: from + 6, insert: 'xxxxxx' }], 'test');
  });
  await expect(image).toHaveAttribute('data-workspace-marker-count', '29');
  await expect(image).toHaveAttribute('data-marker-count', '29');
  await page.evaluate(() => {
    const fixture = (window as any).minimapFixture;
    fixture.documents.get('a.md').undo();
    fixture.search.publishSearchResultHighlights('', new Map());
  });
  await page.locator('.cm-search input[name="search"]').focus();
  await page.keyboard.press('Escape');
  await expect(image).toHaveAttribute('data-workspace-marker-count', '0');
  await expect(image).toHaveAttribute('data-marker-count', '0');
});

test('panel persistence, full long-note sampling, themes, resize and fast file switches retain document ownership', async ({ page }) => {
  await page.evaluate(async () => {
    const fixture = (window as any).minimapFixture;
    fixture.store.getState().setRightPanel('outline');
    await fixture.store.getState().loadUiState();
  });
  await expect(page.locator('.markdown-minimap')).toBeVisible();
  expect(await page.evaluate(() => (window as any).minimapFixture.store.getState().rightPanel)).toBe('minimap');
  await page.evaluate(() => {
    const fixture = (window as any).minimapFixture;
    fixture.documents.get('a.md').setRawText(Array.from({ length: 30000 }, (_, index) => `line ${index}`).join('\n'));
  });
  await expect(page.locator('.markdown-minimap canvas')).toHaveAttribute('data-source-lines', '30000');
  const size = await page.locator('.markdown-minimap canvas').evaluate((element: HTMLCanvasElement) => ({ width: element.width, height: element.height }));
  expect(size.height).toBeLessThanOrEqual(2048);
  expect(size.width).toBeLessThanOrEqual(512);
  const before = Number(await page.locator('.markdown-minimap canvas').getAttribute('data-paint-count'));
  await page.evaluate(() => document.querySelector('.app')!.classList.replace('theme-light', 'theme-dark'));
  await expect.poll(async () => Number(await page.locator('.markdown-minimap canvas').getAttribute('data-paint-count'))).toBeGreaterThan(before);
  await page.setViewportSize({ width: 520, height: 600 });
  await expect(page.locator('.markdown-minimap')).toBeVisible();
  await expect.poll(async () => Number(await page.locator('.markdown-minimap canvas').getAttribute('data-source-width'))).toBeLessThanOrEqual(520);
  const narrow = await page.evaluate(() => {
    const fixture = (window as any).minimapFixture;
    const view = fixture.navigation.navigationView('a.md', 'main');
    const canvas = document.querySelector('.markdown-minimap canvas') as HTMLCanvasElement;
    return { column: view.contentDOM.getBoundingClientRect().width, source: Number(canvas.dataset.sourceWidth) };
  });
  expect(Math.abs(narrow.source - narrow.column)).toBeLessThanOrEqual(2);
  await page.screenshot({ path: test.info().outputPath('minimap-narrow-dark.png') });
  await page.evaluate(async () => {
    const fixture = (window as any).minimapFixture;
    fixture.store.setState({ activePath: 'b.md' });
    await fixture.documents.open('b.md');
    fixture.store.getState().setRightPanel('outline');
  });
  await expect(page.locator('.outline-item')).toContainText('Other note');
  await expect(page.locator('.markdown-minimap canvas')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).minimapFixture.documents.get('a.md').snapshot.text.split('\n').length)).toBe(30000);
});

test('live and reading minimaps reuse the existing editor and never execute another script or mutate notes', async ({ page }) => {
  await page.evaluate(() => {
    const fixture = (window as any).minimapFixture;
    const session = fixture.documents.get('a.md');
    session.setRawText(session.snapshot.raw + '\n\n```js-widget\nwindow.minimapScriptCount=(window.minimapScriptCount||0)+1; container.textContent="widget";\n```\n');
    fixture.store.getState().setViewMode('live');
  });
  await expect(page.locator('.workspace [data-mode="live"]')).toBeVisible();
  const before = await page.evaluate(() => {
    const fixture = (window as any).minimapFixture;
    return { text: fixture.documents.get('a.md').snapshot.raw, editors: document.querySelectorAll('.cm-editor').length,
      scripts: (window as any).minimapScriptCount ?? 0 };
  });
  for (const mode of ['live', 'reading'] as const) {
    await page.evaluate(mode => (window as any).minimapFixture.store.getState().setViewMode(mode), mode);
    const map = page.locator('.markdown-minimap');
    const rect = (await map.boundingBox())!;
    await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height * 0.6);
    await expect.poll(() => page.evaluate(() => (window as any).minimapFixture.navigation.navigationView('a.md', 'main').scrollDOM.scrollTop)).toBeGreaterThan(1000);
    expect(await page.evaluate(() => ({ text: (window as any).minimapFixture.documents.get('a.md').snapshot.raw,
      editors: document.querySelectorAll('.cm-editor').length, scripts: (window as any).minimapScriptCount ?? 0 }))).toEqual(before);
  }
  expect(await page.locator('.markdown-minimap .cm-editor').count()).toBe(0);
});

test('typing in the real SearchPanel publishes API source ranges to the minimap and clears on query changes and unmount', async ({ page }) => {
  const requests: string[] = [];
  await page.route('**/api/search**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/search') return route.fulfill({ json: { hits: [{ path: 'a.md', title: 'First heading', score: 1, snippet: 'needle' }] } });
    if (url.pathname === '/api/search/matches') {
      const body = route.request().postDataJSON();
      requests.push(body.query);
      const sourceRanges = body.query === 'needle' ? [...source.matchAll(/needle/g)].map(match => ({ from: match.index!, to: match.index! + 6, text: 'needle' })) : [];
      return route.fulfill({ json: { matches: [{ path: 'a.md', count: sourceRanges.length, contexts: [], sourceRanges }] } });
    }
    return route.fallback();
  });
  await page.evaluate(async () => {
    const load = (path: string) => import(path);
    const [React, ReactDOM, { default: SearchPanel }] = await Promise.all([
      load('/node_modules/.vite/deps/react.js'), load('/node_modules/.vite/deps/react-dom_client.js'), load('/src/components/SearchPanel.tsx'),
    ]);
    const host = document.createElement('aside');
    host.id = 'real-search-panel';
    host.style.cssText = 'position:fixed;top:0;left:0;width:160px;height:500px;z-index:20;background:var(--background-primary)';
    document.body.append(host);
    const root = (ReactDOM.createRoot ?? ReactDOM.default.createRoot)(host);
    root.render((React.default ?? React).createElement(SearchPanel));
    (window as any).minimapFixture.searchRoot = root;
  });
  const query = page.locator('#real-search-panel .search-input');
  await query.fill('needle');
  const image = page.locator('.markdown-minimap canvas');
  await expect(image).toHaveAttribute('data-workspace-marker-count', '30');
  expect(requests).toContain('needle');
  await query.fill('absent');
  await expect(image).toHaveAttribute('data-workspace-marker-count', '0');
  await query.fill('needle');
  await expect(image).toHaveAttribute('data-workspace-marker-count', '30');
  await page.evaluate(() => (window as any).minimapFixture.searchRoot.unmount());
  await expect(image).toHaveAttribute('data-workspace-marker-count', '0');
});
