import { test, expect } from './test';

test.beforeEach(async ({ page }) => {
  await page.goto('/__render-test');
  await page.waitForFunction(() => Boolean(window.renderHarness));
  await expect(page.locator('.cm-editor')).toHaveCount(2);
});

test('equal footnote DOM transfers cleanup to the replacement widget', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { EditorView } = await import('/node_modules/.vite/deps/@codemirror_view.js');
    const { EditorState } = await import('/node_modules/.vite/deps/@codemirror_state.js');
    const { syntaxModel } = await import('/src/lib/syntaxModel.ts');
    const { compositionSelection } = await import('/src/lib/editorSelection.ts');
    const { livePreviewState, livePreviewReadonly } = await import('/src/lib/renderState.ts');
    const { renderContext } = await import('/src/lib/renderContext.ts');
    const { semanticDecorations } = await import('/src/lib/semanticDecorations.ts');
    let mounted = 0, disposed = 0;
    const host = document.createElement('div'); document.body.append(host);
    const view = new EditorView({ parent: host, state: EditorState.create({ doc: 'ref[^a]\n\n[^a]: footnote', extensions: [
      syntaxModel, compositionSelection, livePreviewState, livePreviewReadonly.init(() => true), EditorState.readOnly.of(true),
      renderContext.of({ sourcePath: 'foot.md', allowPlugins: false, openLink() {}, openMenu() {},
        mountFragment: () => { mounted++; return () => { disposed++; }; } }), semanticDecorations,
    ] }) });
    const widget = () => {
      let found: any;
      view.state.field(semanticDecorations).between(0, view.state.doc.length, (_from: number, _to: number, decoration: any) => {
        if (decoration.spec.widget?.note) found = decoration.spec.widget;
      }); return found;
    };
    const before = widget(), dom = host.querySelector('.cm-footnote-entry');
    view.dispatch({ selection: { anchor: 1 } });
    const after = widget(), reused = dom === host.querySelector('.cm-footnote-entry');
    view.destroy(); after.destroy(dom); host.remove();
    return { mounted, disposed, replacedInstance: before !== after, reused, equal: before.eq(after) };
  });
  expect(result).toEqual({ mounted: 1, disposed: 1, replacedInstance: true, reused: true, equal: true });
});

test('public MarkdownRenderer settles when unloaded before ready', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { Component } = await import('/src/lib/obsidian/events.ts');
    const { MarkdownRenderer, sharedApp } = await import('/src/lib/obsidian/runtime.ts');
    const host = document.createElement('div'); document.body.append(host);
    const owner = new Component(); await owner.load();
    const rendering = MarkdownRenderer.render(sharedApp, 'cancelled', host, 'cancel.md', owner);
    owner.unload(); await rendering; await new Promise(resolve => setTimeout(resolve, 30));
    const result = { pending: host.hasAttribute('data-render-pending'), editors: host.querySelectorAll('.cm-editor').length };
    host.remove(); return result;
  });
  expect(result).toEqual({ pending: false, editors: 0 });
});

test('postprocessors abort old work synchronously and preserve newer output', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { Component } = await import('/src/lib/obsidian/events.ts');
    const { registerPostProcessor, pluginPostProcessing } = await import('/src/lib/obsidian/markdown.ts');
    const { EditorView } = await import('/node_modules/.vite/deps/@codemirror_view.js');
    const { EditorState } = await import('/node_modules/.vite/deps/@codemirror_state.js');
    const { renderContext } = await import('/src/lib/renderContext.ts');
    const { livePreviewState } = await import('/src/lib/renderState.ts');
    const owner = new Component(); await owner.load();
    let release!: () => void, first: any, oldRoot: HTMLElement, cleaned = 0, writes = 0;
    const gate = new Promise<void>(resolve => { release = resolve; });
    registerPostProcessor(owner, async (root: HTMLElement, context: any) => {
      if (!first) {
        first = context; oldRoot = root;
        context.addChild(Object.assign(new Component(), { onunload() { cleaned++; } }));
        await gate;
        if (!context.isCurrent()) return;
        context.assertActive(); root.dataset.architectureOutput = 'old'; writes++;
      } else root.dataset.architectureOutput = 'new';
    });
    const host = document.createElement('div'); document.body.append(host);
    const reading = new EditorView({ parent: host, state: EditorState.create({ doc: 'initial', extensions: [
      EditorState.readOnly.of(true), renderContext.of({ sourcePath: 'processor.md' }), livePreviewState, pluginPostProcessing,
    ] }) });
    for (let attempts = 0; !first && attempts < 100; attempts++) await new Promise(resolve => setTimeout(resolve, 10));
    if (!first) throw new Error('postprocessor was not invoked');
    const view = EditorView.findFromDOM(oldRoot!);
    view.dispatch({ changes: { from: 0, to: 0, insert: 'updated ' } });
    const abortedSynchronously = first.signal.aborted;
    await new Promise(resolve => setTimeout(resolve, 25)); release(); await gate;
    await new Promise(resolve => setTimeout(resolve, 25));
    const output = oldRoot!.dataset.architectureOutput;
    reading.destroy(); owner.unload(); host.remove();
    return { abortedSynchronously, cleaned, writes, output };
  });
  expect(result).toEqual({ abortedSynchronously: true, cleaned: 1, writes: 0, output: 'new' });
});

test('browser Component cancels actual DOM listeners from an in-flight onload before reloading', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { Component } = await import('/src/lib/obsidian/events.ts');
    const owner = new Component(), host = document.createElement('button'); document.body.append(host);
    let release!: () => void, calls = 0, listenerHits = 0, disposed = 0;
    const gate = new Promise<void>(resolve => { release = resolve; });
    owner.onload = async () => {
      const cycle = ++calls;
      if (cycle === 1) await gate;
      owner.registerDomEvent(host, 'click', () => { listenerHits++; });
      owner.register(() => { disposed++; });
    };
    const first = owner.load(); owner.unload(); const second = owner.load(); release();
    await Promise.all([first, second]); host.click(); owner.unload(); host.click(); host.remove();
    return { calls, listenerHits, disposed };
  });
  expect(result).toEqual({ calls: 2, listenerHits: 1, disposed: 2 });
});

test('HTML tags entities and breaks inside inline math have one owner in both modes', async ({ page }) => {
  const source = '正文 $\\text{<b>x</b>}$ 和 $a &amp; b$ 与 $\\text{<br>}$\n\n> $\\text{<i>y</i>}$\n\noutside <b>visible</b> &amp;\n\nend';
  await page.evaluate(raw => window.renderHarness.reset(raw), source);
  await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe(source);
  await page.evaluate(position => window.renderHarness.cursor(0, position), source.length);
  for (const slot of [0, 1]) {
    const host = page.locator(`[data-slot="${slot}"]`);
    await expect(host.locator('.md-html-b')).toHaveText('visible');
    await expect(host.locator('.md-html-i,.cm-html-break')).toHaveCount(0);
    await expect(host.locator('.cm-html-entity')).toHaveCount(1);
  }
  await page.evaluate(position => window.renderHarness.cursor(0, position), source.indexOf('<b>x'));
  await expect(page.locator('[data-slot="0"] .cm-content')).toContainText('$\\text{<b>x</b>}$');
  await expect(page.locator('[data-slot="0"] .md-html-b')).toHaveText('visible');
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
});

test('unclosed math retains HTML and entity source without a competing widget', async ({ page }) => {
  const source = '正文 $a &amp; <b>x</b>\n\nend';
  await page.evaluate(raw => window.renderHarness.reset(raw), source);
  await expect(page.locator('[data-slot="1"] .cm-html-entity,.md-html-b')).toHaveCount(0);
  expect(await page.evaluate(() => window.renderHarness.source(1))).toBe(source);
});

test('Mermaid cancelled during fonts cannot write late output', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { EditorView } = await import('/node_modules/.vite/deps/@codemirror_view.js');
    const { mermaidField } = await import('/src/lib/livePreview.ts');
    const { renderContext } = await import('/src/lib/renderContext.ts');
    const { syntaxModel, blockModel } = await import('/src/lib/syntaxModel.ts');
    const { compositionSelection } = await import('/src/lib/editorSelection.ts');
    const { livePreviewState, livePreviewReadonly } = await import('/src/lib/renderState.ts');
    const { EditorState } = await import('/node_modules/.vite/deps/@codemirror_state.js');
    const host = document.createElement('div'); document.body.append(host);
    const nativeLoad = document.fonts.load.bind(document.fonts);
    let release!: () => void, calls = 0;
    const gate = new Promise<void>(resolve => { release = resolve; });
    document.fonts.load = async () => { calls++; await gate; return []; };
    const view = new EditorView({ parent: host, state: EditorState.create({ doc: '```mermaid\nflowchart TD\nA-->B\n```', extensions: [
      syntaxModel, blockModel, compositionSelection, livePreviewState, livePreviewReadonly.init(() => true),
      renderContext.of({ sourcePath: 'mermaid.md' }), mermaidField,
    ] }) });
    for (let attempt = 0; !calls && attempt < 300; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    if (!calls) throw new Error('Mermaid did not reach font loading');
    const dom = host.querySelector('.cm-mermaid')!; view.destroy(); release();
    await new Promise(resolve => setTimeout(resolve, 100)); document.fonts.load = nativeLoad;
    const result = { calls, pending: dom.hasAttribute('data-render-pending'), svg: dom.querySelectorAll('svg').length, orphans: document.querySelectorAll('[id^="dcm-mmd-"]').length };
    host.remove(); return result;
  });
  expect(result).toEqual({ calls: 1, pending: false, svg: 0, orphans: 0 });
});

test('concurrent Mermaid parse failures remove only their own stages', async ({ page }) => {
  await page.evaluate(() => window.renderHarness.reset('```mermaid\ninvalid first!\n```\n\n```mermaid\ninvalid second!\n```\n\n```mermaid\nflowchart TD\nA-->B\n```\n\nend'));
  await expect(page.locator('[data-slot="1"] .cm-mermaid.mod-error')).toHaveCount(2);
  await expect(page.locator('[data-slot="1"] .cm-mermaid svg')).toHaveCount(1);
  await expect(page.locator('[data-render-pending]')).toHaveCount(0);
  await expect(page.locator('[id^="dcm-mmd-"]')).toHaveCount(0);
});

test('Mermaid completion after destroy cannot reinsert SVG or orphan its render stage', async ({ page }) => {
  await page.evaluate(async () => {
    const { diagramRenderer } = await import('/src/lib/diagrams.ts');
    diagramRenderer.render = async (_id: string, _code: string, stage?: HTMLElement, signal?: AbortSignal) => {
      await Promise.resolve();
      if (signal?.aborted) return { svg: '' };
      return new Promise(resolve => {
        ((window as any).architectureMermaids ||= []).push({ stage, finish: () => resolve({ svg: '<svg id="late-diagram"></svg>' } as any) });
      });
    };
  });
  await page.evaluate(() => window.renderHarness.reset('```mermaid\nflowchart TD\nA-->B\n```\n\nend'));
  await expect(page.locator('[data-slot="0"] .cm-content')).toContainText('end');
  await page.evaluate(() => window.renderHarness.cursor(0, window.renderHarness.source(0).length));
  await page.waitForFunction(() => (window as any).architectureMermaids?.length === 2);
  await page.evaluate(() => {
    (window as any).architectureRoots = [...document.querySelectorAll('.cm-mermaid')];
    window.renderHarness.reset('replacement');
  });
  await expect(page.locator('.cm-mermaid')).toHaveCount(0);
  const result = await page.evaluate(async () => {
    const roots: HTMLElement[] = (window as any).architectureRoots;
    (window as any).architectureMermaids.forEach((job: any) => job.finish()); await new Promise(resolve => setTimeout(resolve, 30));
    return { jobs: (window as any).architectureMermaids.length, lateSvg: roots.some(root => Boolean(root.querySelector('#late-diagram'))),
      orphans: document.querySelectorAll('[id^="dcm-mmd-"]').length, pending: roots.some(root => root.hasAttribute('data-render-pending')) };
  });
  expect(result.jobs).toBe(2);
  expect(result).toMatchObject({ lateSvg: false, orphans: 0, pending: false });
});

test('print initial stylesheet loading is bounded and cleans its iframe', async ({ page }) => {
  await page.route('**/architecture-never.css', () => {});
  const result = await page.evaluate(async () => {
    const { preparePrintDocument } = await import('/src/lib/printDocument.ts');
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/architecture-never.css'; document.head.append(link);
    const started = performance.now();
    try { await preparePrintDocument({ id: 'print.md', text: 'text' } as any, {} as any, { timeoutMs: 150 }); return { error: '', frames: -1, elapsed: 0 }; }
    catch (error) { return { error: String(error), frames: document.querySelectorAll('.note-print-frame').length, elapsed: performance.now() - started }; }
    finally { link.remove(); }
  });
  expect(result.error).toContain('未加载完成'); expect(result.frames).toBe(0); expect(result.elapsed).toBeLessThan(2000);
});

test('print cancellation covers pending stylesheet preparation', async ({ page }) => {
  await page.route('**/architecture-cancel.css', () => {});
  const result = await page.evaluate(async () => {
    const { preparePrintDocument } = await import('/src/lib/printDocument.ts');
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/architecture-cancel.css'; document.head.append(link);
    const controller = new AbortController();
    const preparing = preparePrintDocument({ id: 'print.md', text: 'text' } as any, {} as any, { signal: controller.signal });
    controller.abort();
    try { await preparing; return ''; } catch (error) { return (error as Error).name + ':' + document.querySelectorAll('.note-print-frame').length; }
    finally { link.remove(); }
  });
  expect(result).toBe('AbortError:0');
});

test('print rejects failed images instead of freezing a missing attachment', async ({ page }) => {
  await page.route('**/architecture-broken.png', route => route.fulfill({ status: 200, contentType: 'image/png', body: 'not an image' }));
  const result = await page.evaluate(async () => {
    const { preparePrintDocument } = await import('/src/lib/printDocument.ts');
    const { renderContext } = await import('/src/lib/renderContext.ts');
    const { EditorView } = await import('/node_modules/.vite/deps/@codemirror_view.js');
    const context = EditorView.findFromDOM(document.querySelector('[data-slot="0"] .cm-editor')).state.facet(renderContext);
    try { await preparePrintDocument({ id: 'print.md', text: '![broken](/architecture-broken.png)' } as any, context, { timeoutMs: 5000 }); return ''; }
    catch (error) { return String(error) + ':' + document.querySelectorAll('.note-print-frame').length; }
  });
  expect(result).toContain('图片或图表加载失败:0');
});

test('print uses its owner document and materializes the end of a long note', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { preparePrintDocument } = await import('/src/lib/printDocument.ts');
    const { renderContext } = await import('/src/lib/renderContext.ts');
    const { EditorView } = await import('/node_modules/.vite/deps/@codemirror_view.js');
    const context = EditorView.findFromDOM(document.querySelector('[data-slot="0"] .cm-editor')).state.facet(renderContext);
    const owner = document.createElement('iframe'); document.body.append(owner);
    const doc = owner.contentDocument!;
    document.querySelectorAll('style').forEach(style => doc.head.append(style.cloneNode(true)));
    const raw = Array.from({ length: 220 }, (_unused, index) => `Paragraph ${index} 正文`).join('\n\n') + '\n\nLAST-PARAGRAPH';
    const prepared = await preparePrintDocument({ id: 'long.md', text: raw } as any, context, { document: doc });
    const result = { owner: prepared.frame.ownerDocument === doc, last: prepared.frame.contentDocument!.body.textContent!.includes('LAST-PARAGRAPH'),
      gaps: prepared.frame.contentDocument!.querySelectorAll('.cm-gap').length, editable: prepared.frame.contentDocument!.querySelectorAll('[contenteditable="true"]').length };
    prepared.dispose(); result.gaps += doc.querySelectorAll('.note-print-frame').length; owner.remove(); return result;
  });
  expect(result).toEqual({ owner: true, last: true, gaps: 0, editable: 0 });
});

test('print font loading shares the preparation deadline and leaves no iframe', async ({ page }) => {
  let fontRequested = false;
  await page.route('**/architecture-pending.woff2', () => { fontRequested = true; });
  const result = await page.evaluate(async () => {
    const { preparePrintDocument } = await import('/src/lib/printDocument.ts');
    const { renderContext } = await import('/src/lib/renderContext.ts');
    const { EditorView } = await import('/node_modules/.vite/deps/@codemirror_view.js');
    const context = EditorView.findFromDOM(document.querySelector('[data-slot="0"] .cm-editor')).state.facet(renderContext);
    const owner = document.createElement('iframe'); document.body.append(owner);
    const style = owner.contentDocument!.createElement('style');
    style.textContent = '@font-face{font-family:ArchitecturePending;src:url(/architecture-pending.woff2)}.cm-content{font-family:ArchitecturePending!important}';
    owner.contentDocument!.head.append(style);
    try { await preparePrintDocument({ id: 'font.md', text: 'FONT PENDING' } as any, context, { document: owner.contentDocument!, timeoutMs: 800 }); return ''; }
    catch (error) { return String(error) + ':' + owner.contentDocument!.querySelectorAll('.note-print-frame').length; }
    finally { owner.remove(); }
  });
  expect(fontRequested).toBe(true); expect(result).toContain('未加载完成:0');
});

test('fragment focus within its iframe commits only when leaving the fragment', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { mountMarkdownFragment } = await import('/src/components/MarkdownFragment.tsx');
    const { renderContext } = await import('/src/lib/renderContext.ts');
    const { EditorView } = await import('/node_modules/.vite/deps/@codemirror_view.js');
    const context = EditorView.findFromDOM(document.querySelector('[data-slot="0"] .cm-editor')).state.facet(renderContext);
    const frame = document.createElement('iframe'); document.body.append(frame);
    const doc = frame.contentDocument!, host = doc.createElement('div'), outside = doc.createElement('button');
    doc.body.append(host, outside); let committed = 0, stop!: () => void;
    await new Promise<void>(resolve => { stop = mountMarkdownFragment(host, 'text', { id: 'iframe.md', mode: 'live',
      context: { ...context, bindEditor: undefined }, onReady: resolve, onCommit: () => { committed++; } }); });
    const button = doc.createElement('button'); host.firstElementChild!.append(button);
    EditorView.findFromDOM(host.querySelector('.cm-editor')).focus(); button.focus(); await Promise.resolve();
    const internal = committed; outside.focus(); await Promise.resolve(); const external = committed;
    stop(); await Promise.resolve(); frame.remove(); return { internal, external };
  });
  expect(result).toEqual({ internal: 0, external: 1 });
});

test('Mermaid fold and inline HTML fields ignore unrelated context but refresh their real inputs', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { EditorState, Compartment } = await import('/node_modules/.vite/deps/@codemirror_state.js');
    const { mermaidField, calloutFoldState, calloutFoldDeco } = await import('/src/lib/livePreview.ts');
    const { inlineHtml } = await import('/src/lib/inlineHtml.ts');
    const { syntaxModel, blockModel } = await import('/src/lib/syntaxModel.ts');
    const { livePreviewState, livePreviewReadonly } = await import('/src/lib/renderState.ts');
    const { renderContext } = await import('/src/lib/renderContext.ts');
    const { refreshBlockEffects } = await import('/src/lib/blocks/model.ts');
    const { toggleSourceRegion, sourceRegion, forcedRenderedRegion } = await import('/src/lib/sourceControls.ts');
    const compartment = new Compartment();
    const context = { sourcePath: 'dependencies.md', allowBlockEffects: false, allowScriptExecution: false };
    const fields = [mermaidField, calloutFoldDeco, inlineHtml[1]];
    const raw = '```mermaid\nflowchart TD\nA-->B\n```\n\n> [!note]- Title\n> body\n\n<b>text</b> &amp;\n\nend';
    let state = EditorState.create({ doc: raw, selection: { anchor: raw.length }, extensions: [syntaxModel, blockModel, livePreviewState, livePreviewReadonly,
      sourceRegion, forcedRenderedRegion,
      compartment.of(renderContext.of(context)), calloutFoldState, mermaidField, calloutFoldDeco, inlineHtml] });
    const changed = (next: any) => fields.map(field => state.field(field) !== next.field(field));
    let next = state.update({ effects: compartment.reconfigure(renderContext.of({ ...context, sourcePath: 'renamed.md', openLink() {} })) }).state;
    const unrelated = changed(next); state = next;
    next = state.update({ effects: refreshBlockEffects.of() }).state;
    const refresh = changed(next); state = next;
    next = state.update({ effects: compartment.reconfigure(renderContext.of({ ...context, allowScriptExecution: true })) }).state;
    const permissions = changed(next); state = next;
    next = state.update({ effects: toggleSourceRegion.of({ from: 0, to: raw.indexOf('\n\n') }) }).state;
    const source = changed(next); state = next;
    next = state.update({ changes: { from: raw.length, insert: ' changed' } }).state;
    const document = changed(next);
    return { unrelated, refresh, permissions, source, document };
  });
  expect(result).toEqual({ unrelated: [false, false, false], refresh: [true, true, true], permissions: [true, true, true],
    source: [true, true, true], document: [true, true, true] });
});

test.describe('controlled fragment failure', () => {
  test.use({ expectedErrors: ['controlled-fragment-failure', 'The above error occurred'] });
  test('shared fragment reports an initial React render failure and clears pending state', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { mountMarkdownFragment } = await import('/src/components/MarkdownFragment.tsx');
      const host = document.createElement('div'); document.body.append(host);
      const context = Object.defineProperty({}, 'sourcePath', { enumerable: true, get() { throw new Error('controlled-fragment-failure'); } });
      let stop!: () => void;
      try {
        await new Promise<void>((resolve, reject) => {
          stop = mountMarkdownFragment(host, 'failure', { id: 'error.md', context: context as any, onReady: resolve, onError: reject });
        });
        return '';
      }
      catch (error) { return (error as Error).message + ':' + host.hasAttribute('data-render-pending'); }
      finally { stop(); await Promise.resolve(); host.remove(); }
    });
    expect(result).toBe('controlled-fragment-failure:false');
  });
});
