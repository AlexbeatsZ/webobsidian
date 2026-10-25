import { test, expect } from './test';

test.beforeEach(async ({ page }) => {
  await page.goto('/__render-test');
  await page.waitForFunction(() => Boolean(window.renderHarness));
});

test('table ignores commits from reading and superseded cell mounts', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { EditorView } = await import('/node_modules/.vite/deps/@codemirror_view.js');
    const { EditorState } = await import('/node_modules/.vite/deps/@codemirror_state.js');
    const { tableField } = await import('/src/lib/livePreview.ts');
    const { syntaxModel, blockModel } = await import('/src/lib/syntaxModel.ts');
    const { compositionSelection } = await import('/src/lib/editorSelection.ts');
    const { livePreviewState, livePreviewReadonly } = await import('/src/lib/renderState.ts');
    const { renderContext } = await import('/src/lib/renderContext.ts');
    const source = '| Head |\n| --- |\n| value |\n\nTail';
    const jobs: { host: HTMLElement; options: any; stops: number }[] = [];
    const host = document.createElement('div'); document.body.append(host);
    const view = new EditorView({ parent: host, state: EditorState.create({ doc: source, extensions: [
      syntaxModel, blockModel, compositionSelection, livePreviewState, livePreviewReadonly,
      renderContext.of({ sourcePath: 'table.md', mountFragment(fragment, raw, options) {
        fragment.textContent = raw;
        const job = { host: fragment, options, stops: 0 }; jobs.push(job);
        return () => { job.stops++; };
      } }), tableField,
    ] }) });
    const bodyCell = () => host.querySelector<HTMLElement>('tbody td')!;
    jobs[1].options.onCommit?.('reading-write');
    const readingSource = view.state.doc.toString();
    bodyCell().click();
    const first = jobs.at(-1)!;
    bodyCell().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    bodyCell().click();
    const current = jobs.at(-1)!;
    await Promise.resolve(); first.options.onCommit?.('late-write');
    const staleSource = view.state.doc.toString();
    current.options.onCommit?.('changed');
    const committed = view.state.doc.toString();
    view.destroy(); host.remove();
    return { readingSource, staleSource, committed, source, firstStops: first.stops, allStoppedOnce: jobs.every(job => job.stops === 1) };
  });
  expect(result.readingSource).toBe(result.source);
  expect(result.staleSource).toBe(result.source);
  expect(result.committed).toBe(result.source.replace('value', 'changed'));
  expect(result.firstStops).toBe(1);
  expect(result.allStoppedOnce).toBe(true);
});

test('equal table widget retains DOM cleanup and invalidates before disposing fragments', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { EditorView } = await import('/node_modules/.vite/deps/@codemirror_view.js');
    const { EditorState } = await import('/node_modules/.vite/deps/@codemirror_state.js');
    const { tableField } = await import('/src/lib/livePreview.ts');
    const { syntaxModel, blockModel } = await import('/src/lib/syntaxModel.ts');
    const { compositionSelection } = await import('/src/lib/editorSelection.ts');
    const { livePreviewState, livePreviewReadonly } = await import('/src/lib/renderState.ts');
    const { renderContext } = await import('/src/lib/renderContext.ts');
    const source = '| Head |\n| --- |\n| value |\n\nTail';
    let mounted = 0, disposed = 0, invokeDuringStop = false;
    const callbacks: (() => void)[] = [];
    const host = document.createElement('div'); document.body.append(host);
    const view = new EditorView({ parent: host, state: EditorState.create({ doc: source, extensions: [
      syntaxModel, blockModel, compositionSelection, livePreviewState, livePreviewReadonly,
      renderContext.of({ sourcePath: 'equal-table.md', mountFragment(fragment, raw, options) {
        mounted++; fragment.textContent = raw;
        const commit = () => options.onCommit?.('late-write'); callbacks.push(commit);
        return () => { disposed++; if (invokeDuringStop) commit(); };
      } }), tableField,
    ] }) });
    const widget = () => {
      let found: any;
      view.state.field(tableField).between(0, view.state.doc.length, (_from: number, _to: number, decoration: any) => {
        found = decoration.spec.widget;
      }); return found;
    };
    host.querySelector<HTMLElement>('tbody td')!.click();
    const before = widget(), dom = host.querySelector<HTMLElement>('.cm-table-wrap')!;
    view.dispatch({ changes: { from: view.state.doc.length, insert: '!' } });
    const after = widget(), reused = dom === host.querySelector('.cm-table-wrap');
    invokeDuringStop = true;
    after.destroy(dom);
    const afterDispose = view.state.doc.toString();
    await Promise.resolve(); callbacks.forEach(callback => callback());
    const afterLate = view.state.doc.toString();
    view.destroy(); after.destroy(dom); host.remove();
    return { replaced: before !== after, equal: before.eq(after), reused, mounted, disposed, afterDispose, afterLate, expected: source + '!' };
  });
  expect(result).toMatchObject({ replaced: true, equal: true, reused: true, mounted: 3, disposed: 3 });
  expect(result.afterDispose).toBe(result.expected);
  expect(result.afterLate).toBe(result.expected);
});

test('actual table cell Escape, commit, source restore and Undo preserve raw bytes', async ({ page }, info) => {
  const source = '\uFEFF> [!info]+ 表格\r\n>\r\n> | Head | Other |\r\n> | :--- | ---: |\r\n> |  value  | untouched 😀 |\r\n\r\nTail';
  await page.evaluate(source => window.renderHarness.reset(source), source);
  const live = page.locator('[data-slot="0"]');
  const cell = live.locator('tbody td').first();
  await cell.click();
  const editor = cell.locator('[contenteditable="true"]');
  await expect(editor).toHaveCount(1);
  await editor.press('Control+a'); await editor.pressSequentially('discarded'); await editor.press('Escape');
  await expect(cell.locator('[contenteditable="true"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
  await cell.click();
  await expect(editor).toHaveCount(1);
  await editor.press('Control+a'); await editor.pressSequentially('changed'); await editor.press('Enter');
  await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe(source.replace('value', 'changed'));
  await expect(page.locator('[data-slot="1"] tbody td').first()).toHaveText('changed');
  await page.evaluate(() => window.renderHarness.undo(0));
  await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe(source);
  await live.getByRole('button', { name: '编辑表格源码' }).click();
  await expect(live.locator('.cm-table')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(live.locator('.cm-table')).toHaveCount(1);
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
  await page.screenshot({ path: info.outputPath('table-source-undo.png'), fullPage: true });
});

test('image owners cancel late load error and active resize on disposal', async ({ page }) => {
  await page.route('**/table-lifetime.svg', () => {});
  const source = '| Head |\n| --- |\n| ![picture](/table-lifetime.svg) |\n\nTail';
  await page.evaluate(source => window.renderHarness.reset(source), source);
  const cell = page.locator('[data-slot="0"] tbody td');
  await expect(cell.locator('img.cm-embed-image')).toHaveCount(1);
  await page.evaluate(async () => {
    const { EditorView } = await import('/node_modules/.vite/deps/@codemirror_view.js');
    const image = document.querySelector<HTMLImageElement>('[data-slot="0"] tbody td img.cm-embed-image')!;
    const view = EditorView.findFromDOM(image.closest('.cm-editor')!)!;
    const probe = { image, view, measures: 0 };
    const request = view.requestMeasure.bind(view);
    view.requestMeasure = (...args: any[]) => { probe.measures++; return request(...args); };
    (window as any).tableImageProbe = probe;
  });
  await cell.click();
  await expect(cell.locator('[contenteditable="true"]')).toHaveCount(1);
  await page.evaluate(() => new Promise<void>(resolve => queueMicrotask(resolve)));
  const result = await page.evaluate(() => {
    const probe = (window as any).tableImageProbe;
    probe.measures = 0;
    probe.image.dispatchEvent(new Event('load'));
    const wrap = probe.image.parentElement!;
    const before = wrap.innerHTML;
    probe.image.dispatchEvent(new Event('error'));
    return { measures: probe.measures, disconnected: !probe.image.isConnected, destroyed: probe.view.destroyed,
      unchanged: before === wrap.innerHTML };
  });
  expect.soft(result).toEqual({ measures: 0, disconnected: true, destroyed: true, unchanged: true });

  const html = '<div><img src="/table-lifetime.svg" alt="first"><img src="/table-lifetime.svg" alt="second"></div>\n\nTail';
  await page.evaluate(source => window.renderHarness.reset(source), html);
  await expect(page.locator('[data-slot="1"] .cm-html-block img')).toHaveCount(2);
  const activeHtmlMeasures = await page.evaluate(async () => {
    const { EditorView } = await import('/node_modules/.vite/deps/@codemirror_view.js');
    const { htmlBlockField } = await import('/src/lib/livePreview.ts');
    const root = document.querySelector<HTMLElement>('[data-slot="1"] .cm-html-block')!;
    const view = EditorView.findFromDOM(root.closest('.cm-editor')!)!;
    const widget = () => { let found: any; view.state.field(htmlBlockField).between(0, view.state.doc.length,
      (_from: number, _to: number, decoration: any) => { found = decoration.spec.widget; }); return found; };
    const probe = { root, view, images: [...root.querySelectorAll('img')], widget, before: widget(), measures: 0 };
    const request = view.requestMeasure.bind(view);
    view.requestMeasure = (...args: any[]) => { probe.measures++; return request(...args); };
    probe.images[0].dispatchEvent(new Event('load'));
    probe.images[1].dispatchEvent(new Event('error'));
    (window as any).htmlImageProbe = probe;
    return probe.measures;
  });
  expect(activeHtmlMeasures).toBe(2);
  await page.evaluate(() => window.renderHarness.edit(0, [{ from: window.renderHarness.source(0).length, insert: '!' }]));
  await expect.poll(() => page.evaluate(() => window.renderHarness.source(1))).toBe(html + '!');
  const equal = await page.evaluate(() => {
    const probe = (window as any).htmlImageProbe, after = probe.widget();
    return { reused: probe.root.isConnected, replaced: probe.before !== after, equal: probe.before.eq(after) };
  });
  expect(equal).toEqual({ reused: true, replaced: true, equal: true });
  await page.evaluate(() => window.renderHarness.mode(1, 'source'));
  await expect(page.locator('[data-slot="1"] .cm-html-block')).toHaveCount(0);
  const htmlResult = await page.evaluate(() => {
    const probe = (window as any).htmlImageProbe;
    probe.measures = 0;
    probe.images.forEach((image: HTMLImageElement) => { image.dispatchEvent(new Event('load')); image.dispatchEvent(new Event('error')); });
    return { measures: probe.measures, disconnected: !probe.root.isConnected, destroyed: probe.view.destroyed };
  });
  expect.soft(htmlResult).toEqual({ measures: 0, disconnected: true, destroyed: false });

  for (const ending of ['source', 'error']) {
    const raw = 'before ![picture](/table-lifetime.svg) after\n\nTail';
    await page.evaluate(source => window.renderHarness.reset(source), raw);
    const image = page.locator('[data-slot="0"] img.cm-embed-image');
    await expect(image).toHaveCount(1);
    await page.evaluate(() => {
      const image = document.querySelector<HTMLImageElement>('[data-slot="0"] img.cm-embed-image')!;
      const wrap = image.closest<HTMLElement>('.cm-image-wrap')!;
      const handle = wrap.querySelector<HTMLElement>('.cm-image-resize-right')!;
      const nativeAdd = window.addEventListener, nativeRemove = window.removeEventListener;
      const listeners = new Map<string, Set<any>>();
      window.addEventListener = function(type: string, callback: any, options: any) {
        if (['mousemove', 'mouseup', 'touchmove', 'touchend'].includes(type)) {
          if (!listeners.has(type)) listeners.set(type, new Set());
          listeners.get(type)!.add(callback);
        }
        return nativeAdd.call(this, type, callback, options);
      } as any;
      window.removeEventListener = function(type: string, callback: any, options: any) {
        listeners.get(type)?.delete(callback);
        return nativeRemove.call(this, type, callback, options);
      } as any;
      handle.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, bubbles: true, cancelable: true }));
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 130 }));
      (window as any).imageResizeProbe = { image, wrap, listeners, width: image.style.width,
        restore() { window.addEventListener = nativeAdd; window.removeEventListener = nativeRemove; } };
    });
    if (ending === 'source') {
      await page.evaluate(() => window.renderHarness.mode(0, 'source'));
      await expect(page.locator('[data-slot="0"] .cm-image-wrap')).toHaveCount(0);
    } else {
      await page.evaluate(() => (window as any).imageResizeProbe.image.dispatchEvent(new Event('error')));
      await expect(page.locator('[data-slot="0"] .cm-image-wrap[data-render-error="image"]')).toHaveCount(1);
      await expect(page.locator('[data-slot="0"] .cm-image-resize')).toHaveCount(0);
    }
    const resize = await page.evaluate(() => {
      const probe = (window as any).imageResizeProbe;
      const listeners = [...probe.listeners.values()].reduce((sum: number, callbacks: any) => sum + callbacks.size, 0);
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 200 }));
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: 200 }));
      const result = { listeners, unchanged: probe.width === probe.image.style.width,
        resizing: probe.wrap.classList.contains('is-resizing'), raw: window.renderHarness.source(0) };
      probe.restore(); return result;
    });
    expect.soft(resize, ending).toEqual({ listeners: 0, unchanged: true, resizing: false, raw });
  }
});
