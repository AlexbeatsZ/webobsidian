import { test, expect } from './test';
import type { Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const source = 'Before\n\n```query\n#chemistry\n```\n\nAfter';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/plugins/adapter', route => route.fulfill({ json: { exists: false, files: [], folders: [] } }));
  await page.route('**/src/components/MarkdownFragment.tsx*', async route => {
    const response = await route.fetch(), body = await response.text();
    const marker = 'export function mountMarkdownFragment(host, source, options) {';
    if (!body.includes(marker)) throw new Error('Public fragment instrumentation no longer matches');
    await route.fulfill({ response, body: body.replace(marker, `${marker}
      const probe = window.publicProcessorProbe;
      if (probe?.throwSync) { host.textContent = 'partial sync candidate'; throw new Error('controlled-public-sync-failure'); }
      if (!probe?.blocked || options.id.includes(':cell:')) return actualProcessorMount(host, source, options);
      let stop;
      const job = { source, cancelled: false,
        release() { if (job.cancelled) options.onReady?.(); else stop = actualProcessorMount(host, source, options); },
        fail() { const alert = host.ownerDocument.createElement('span'); alert.setAttribute('role', 'alert');
          alert.textContent = 'controlled-public-fragment-failure'; host.append(alert);
          options.onError?.(new Error('controlled-public-fragment-failure')); }
      };
      probe.jobs.push(job);
      return () => { job.cancelled = true; stop?.(); };
    }
    function actualProcessorMount(host, source, options) {`) });
  });
  await page.goto('/__render-test');
  await page.waitForFunction(() => Boolean(window.renderHarness));
});

async function queryFixture(page: Page) {
  await page.evaluate(async source => {
    const { EditorView } = await import('/node_modules/.vite/deps/@codemirror_view.js');
    const { EditorState } = await import('/node_modules/.vite/deps/@codemirror_state.js');
    const { syntaxModel, blockModel } = await import('/src/lib/syntaxModel.ts');
    const { compositionSelection } = await import('/src/lib/editorSelection.ts');
    const { livePreviewState, livePreviewReadonly } = await import('/src/lib/renderState.ts');
    const { renderContext } = await import('/src/lib/renderContext.ts');
    const { codeBlocks } = await import('/src/lib/obsidian/markdown.ts');
    const { installQueryBlocks } = await import('/src/lib/queryBlock.ts');
    const { api } = await import('/src/lib/api.ts');
    const { updateSearch } = await import('/src/lib/search.ts');
    const jobs: any[] = [];
    api.search = (_query: string, _limit: number, signal: AbortSignal) => new Promise((resolve, reject) => {
      jobs.push({ resolve, reject, signal });
    });
    const stop = installQueryBlocks();
    const host = document.createElement('div'); host.id = 'processor-fixture'; document.body.prepend(host);
    const createView = () => new EditorView({ parent: host, state: EditorState.create({ doc: source, extensions: [
      syntaxModel, blockModel, compositionSelection, livePreviewState, livePreviewReadonly.init(() => true),
      EditorState.readOnly.of(true), renderContext.of({ sourcePath: 'transition.md', allowPlugins: true }), codeBlocks,
    ] }) });
    const view = createView();
    (window as any).processorProbe = { jobs, view, host, stop, createView,
      refresh: () => updateSearch({}),
      hit: (title: string) => ({ path: `${title}.md`, title, snippet: `${title} snippet` }),
    };
  }, source);
  await expect.poll(() => page.evaluate(() => (window as any).processorProbe.jobs.length)).toBe(1);
}

async function finish(page: Page, index: number, titles: string[]) {
  await page.evaluate(({ index, titles }) => {
    const probe = (window as any).processorProbe;
    probe.jobs[index].resolve({ hits: titles.map(probe.hit) });
  }, { index, titles });
  await expect(page.locator('#processor-fixture [role="status"]').last()).not.toHaveText('搜索中…');
}

async function refresh(page: Page, count: number) {
  await page.route('**/api/settings{,/**}', route => route.fulfill({ json: {} }));
  await page.evaluate(() => (window as any).processorProbe.refresh());
  await expect.poll(() => page.evaluate(() => (window as any).processorProbe.jobs.length)).toBe(count);
}

async function frames(page: Page, count = 8) {
  return page.evaluate(count => new Promise<any[]>(resolve => {
    const samples: any[] = [];
    const frame = (time: number) => {
      const host = document.querySelector<HTMLElement>('#processor-fixture .plugin-code-block')!;
      samples.push({ time, text: host.textContent, rows: host.querySelectorAll('li').length,
        height: host.getBoundingClientRect().height, pending: host.hasAttribute('data-render-pending') });
      if (--count) requestAnimationFrame(frame); else resolve(samples);
    };
    requestAnimationFrame(frame);
  }), count);
}

test('query refresh retains successful rows in every delayed frame and after failure', async ({ page }, info) => {
  await queryFixture(page);
  await finish(page, 0, ['Stable first', 'Stable second']);
  const original = await page.locator('#processor-fixture li').first().elementHandle();
  await refresh(page, 2);
  const samples = await frames(page);
  await writeFile(info.outputPath('query-pending-frames.json'), JSON.stringify(samples, null, 2));
  await page.screenshot({ path: info.outputPath('query-pending.png'), fullPage: true });
  await page.evaluate(() => (window as any).processorProbe.jobs[1].reject(new Error('controlled-query-failure')));
  await expect(page.locator('#processor-fixture [role="status"]').last()).toContainText('controlled-query-failure');
  expect(samples.every(sample => sample.rows === 2)).toBe(true);
  expect(await original!.evaluate(node => node.isConnected)).toBe(true);
  await expect(page.locator('#processor-fixture li')).toHaveCount(2);
  expect(await page.evaluate(() => (window as any).processorProbe.view.state.doc.toString())).toBe(source);
});

test('query ignores out-of-order aborted success and errors and commits an empty result', async ({ page }) => {
  await queryFixture(page);
  await finish(page, 0, ['Original']);
  await refresh(page, 2);
  await refresh(page, 3);
  expect(await page.evaluate(() => (window as any).processorProbe.jobs[1].signal.aborted)).toBe(true);
  await finish(page, 2, ['Newest']);
  await page.evaluate(() => (window as any).processorProbe.jobs[1].resolve({ hits: [(window as any).processorProbe.hit('Obsolete')] }));
  await frames(page, 3);
  await expect(page.locator('#processor-fixture li')).toHaveText(['NewestNewest snippet']);
  await refresh(page, 4);
  await refresh(page, 5);
  await finish(page, 4, []);
  await page.evaluate(() => (window as any).processorProbe.jobs[3].reject(new Error('obsolete-error')));
  await frames(page, 3);
  await expect(page.locator('#processor-fixture [role="status"]').last()).toHaveText('没有搜索结果');
  await expect(page.locator('#processor-fixture li')).toHaveCount(0);
});

test('query destruction aborts requests and suppresses late cancellation errors', async ({ page }) => {
  await queryFixture(page);
  const result = await page.evaluate(async () => {
    const probe = (window as any).processorProbe;
    const host = probe.host.querySelector('.plugin-code-block');
    probe.view.destroy();
    probe.jobs[0].reject(new DOMException('cancelled fixture', 'AbortError'));
    await new Promise(resolve => setTimeout(resolve, 40));
    return { aborted: probe.jobs[0].signal.aborted, pending: host.hasAttribute('data-render-pending'), error: host.classList.contains('mod-error'), text: host.textContent };
  });
  expect(result).toMatchObject({ aborted: true, pending: false, error: false });
  expect(result.text).not.toContain('AbortError');
});

test('cold code processor displays status without raw fenced source then reports failure', async ({ page }, info) => {
  await queryFixture(page);
  await page.evaluate(async () => {
    const probe = (window as any).processorProbe;
    probe.view.destroy(); probe.stop();
    const { registerCodeProcessor } = await import('/src/lib/obsidian/markdown.ts');
    const { Component } = await import('/src/lib/obsidian/events.ts');
    const owner = new Component(); await owner.load();
    registerCodeProcessor(owner, 'query', async () => new Promise((_resolve, reject) => { probe.reject = reject; }));
    probe.owner = owner;
    probe.view = probe.createView();
  });
  await page.waitForFunction(() => Boolean((window as any).processorProbe.reject));
  const samples = await frames(page);
  await writeFile(info.outputPath('processor-cold-frames.json'), JSON.stringify(samples, null, 2));
  expect(samples.every(sample => Boolean(sample.text?.trim()))).toBe(true);
  expect(samples.every(sample => !sample.text.includes('#chemistry') && !sample.text.includes('```'))).toBe(true);
  await page.evaluate(() => (window as any).processorProbe.reject(new Error('controlled-processor-failure')));
  await expect(page.locator('#processor-fixture .mod-error')).toContainText('controlled-processor-failure');
  await expect(page.locator('#processor-fixture [data-render-pending]')).toHaveCount(0);
});

test('public MarkdownRenderer owns one mount per host across replacement and old-owner unload', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { MarkdownRenderer, sharedApp } = await import('/src/lib/obsidian/runtime.ts');
    const { Component } = await import('/src/lib/obsidian/events.ts');
    const first = new Component(), second = new Component(); await first.load(); await second.load();
    const host = document.createElement('div'); host.id = 'public-renderer-fixture'; document.body.prepend(host);
    await MarkdownRenderer.render(sharedApp, 'First output', host, 'first.md', first);
    await MarkdownRenderer.render(sharedApp, 'Newest output', host, 'second.md', second);
    first.unload();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const afterOldUnload = host.textContent;
    second.unload();
    await new Promise(resolve => setTimeout(resolve, 30));
    return { afterOldUnload, remaining: host.querySelectorAll('.cm-editor').length, pending: host.hasAttribute('data-render-pending') };
  });
  expect(result).toEqual({ afterOldUnload: 'Newest output', remaining: 0, pending: false });
});

test('public MarkdownRenderer keeps prior content through delayed replacement failure cancellation and retry', async ({ page }, info) => {
  await page.evaluate(async () => {
    const { MarkdownRenderer, sharedApp } = await import('/src/lib/obsidian/runtime.ts');
    const { Component } = await import('/src/lib/obsidian/events.ts');
    const owner = new Component(); await owner.load();
    const host = document.createElement('div'); host.id = 'public-renderer-fixture'; document.body.prepend(host);
    await MarkdownRenderer.render(sharedApp, 'Stable public output', host, 'public.md', owner);
    const probe: any = { blocked: true, jobs: [], host, owner, errors: [], settled: 0,
      render: (source: string) => MarkdownRenderer.render(sharedApp, source, host, 'public.md', owner)
        .catch(error => probe.errors.push(error.message)).finally(() => probe.settled++),
    };
    (window as any).publicProcessorProbe = probe;
    void probe.render('Stable public output');
  });
  await page.waitForFunction(() => (window as any).publicProcessorProbe.jobs.length === 1);
  const original = await page.locator('#public-renderer-fixture .cm-editor').elementHandle();
  const samples = await page.evaluate(() => new Promise<any[]>(resolve => {
    const samples: any[] = [];
    const frame = (time: number) => {
      const host = (window as any).publicProcessorProbe.host;
      samples.push({ time, text: host.innerText, pending: host.hasAttribute('data-render-pending') });
      if (samples.length < 8) requestAnimationFrame(frame); else resolve(samples);
    };
    requestAnimationFrame(frame);
  }));
  await writeFile(info.outputPath('public-pending-frames.json'), JSON.stringify(samples, null, 2));
  expect(samples.every(sample => sample.text.includes('Stable public output') && sample.pending)).toBe(true);
  await page.evaluate(() => (window as any).publicProcessorProbe.jobs[0].fail());
  await expect(page.locator('#public-renderer-fixture [role="alert"]')).toContainText('controlled-public-fragment-failure');
  await expect(page.locator('#public-renderer-fixture [role="alert"]')).toBeVisible();
  await expect(page.locator('#public-renderer-fixture .cm-editor')).toHaveCount(1);
  await expect(page.locator('#public-renderer-fixture')).toHaveText('Stable public outputcontrolled-public-fragment-failure');
  expect(await original!.evaluate(node => node.isConnected)).toBe(true);
  await page.evaluate(() => { void (window as any).publicProcessorProbe.render('Stable public output'); });
  await page.waitForFunction(() => (window as any).publicProcessorProbe.jobs.length === 2);
  await page.evaluate(() => { void (window as any).publicProcessorProbe.render('Stable public output'); });
  await page.waitForFunction(() => (window as any).publicProcessorProbe.jobs.length === 3);
  expect(await page.evaluate(() => (window as any).publicProcessorProbe.jobs[1].cancelled)).toBe(true);
  await page.evaluate(() => (window as any).publicProcessorProbe.jobs[2].release());
  await expect(page.locator('#public-renderer-fixture')).toHaveText('Stable public output');
  await page.evaluate(() => (window as any).publicProcessorProbe.jobs[1].release());
  const result = await page.evaluate(async () => {
    const probe = (window as any).publicProcessorProbe;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const result = { text: probe.host.innerText, errors: probe.errors, settled: probe.settled,
      pending: probe.host.hasAttribute('data-render-pending'), error: probe.host.hasAttribute('data-render-error') };
    probe.owner.unload(); return result;
  });
  expect(result).toEqual({ text: 'Stable public output', errors: ['controlled-public-fragment-failure'], settled: 3, pending: false, error: false });
});

test('code processor survives unrelated edits and leaves native source editing and Undo intact', async ({ page }) => {
  await page.evaluate(async () => {
    const { registerCodeProcessor } = await import('/src/lib/obsidian/markdown.ts');
    const { Component } = await import('/src/lib/obsidian/events.ts');
    const owner = new Component(); await owner.load();
    (window as any).editProcessorProbe = { owner, calls: 0, aborted: 0 };
    registerCodeProcessor(owner, 'transition', async (_source: string, host: HTMLElement, context: any) => {
      const probe = (window as any).editProcessorProbe;
      probe.calls++; context.signal.addEventListener('abort', () => probe.aborted++);
      const output = document.createElement('button'); output.textContent = 'Persistent processor control'; host.append(output);
    });
    window.renderHarness.reset('Before\n\n```transition\noriginal source\n```\n\nAfter');
  });
  const raw = 'Before\n\n```transition\noriginal source\n```\n\nAfter';
  await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe(raw);
  await page.evaluate(async () => {
    const { EditorView } = await import('/node_modules/.vite/deps/@codemirror_view.js');
    const { Prec, StateEffect } = await import('/node_modules/.vite/deps/@codemirror_state.js');
    const { renderContext } = await import('/src/lib/renderContext.ts');
    for (const element of document.querySelectorAll('.cm-editor')) {
      const view = EditorView.findFromDOM(element)!;
      view.dispatch({ effects: StateEffect.appendConfig.of(Prec.highest(renderContext.of({ ...view.state.facet(renderContext), allowPlugins: true }))) });
    }
  });
  await page.evaluate(() => window.renderHarness.cursor(0, window.renderHarness.source(0).length));
  await expect(page.locator('[data-slot="0"] .block-language-transition button:not(.cm-source-toggle)')).toHaveText('Persistent processor control');
  const original = await page.locator('[data-slot="0"] .block-language-transition button:not(.cm-source-toggle)').elementHandle();
  const calls = await page.evaluate(() => (window as any).editProcessorProbe.calls);
  await page.evaluate(() => window.renderHarness.edit(0, [{ from: 0, to: 0, insert: 'prefix\n' }]));
  expect(await original!.evaluate(node => node.isConnected)).toBe(true);
  expect(await page.evaluate(() => (window as any).editProcessorProbe.calls)).toBe(calls);
  await page.evaluate(() => {
    const raw = window.renderHarness.source(0);
    window.renderHarness.cursor(0, raw.indexOf('original source') + 4);
    window.renderHarness.focus(0);
  });
  await expect(page.locator('[data-slot="0"] .block-language-transition')).toHaveCount(0);
  await page.keyboard.type('X');
  await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe('prefix\n' + raw.replace('original source', 'origXinal source'));
  await page.keyboard.press('Control+z');
  await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe('prefix\n' + raw);
});

test('configured block effect retains completed output while its watched dependency renders again', async ({ page }, info) => {
  await page.route('**/api/native-features/blocks', route => route.fulfill({ json: { vault: 'browser-fixture', definitions: [{
    names: ['async-transition'], classes: ['async-transition'], script: 'async-transition.js', code: `
      block.watch('dependency.md');
      await new Promise((resolve, reject) => window.effectProcessorProbe.jobs.push({ signal: block.signal,
        finish(label) { if (!block.signal.aborted) block.container.textContent = label; resolve(); }, fail: reject
      }));
    `,
  }] } }));
  await page.evaluate(async () => {
    const { EditorView } = await import('/node_modules/.vite/deps/@codemirror_view.js');
    const { EditorState } = await import('/node_modules/.vite/deps/@codemirror_state.js');
    const { syntaxModel, blockModel } = await import('/src/lib/syntaxModel.ts');
    const { compositionSelection } = await import('/src/lib/editorSelection.ts');
    const { livePreviewState, livePreviewReadonly } = await import('/src/lib/renderState.ts');
    const { renderContext } = await import('/src/lib/renderContext.ts');
    const { blockEffects } = await import('/src/lib/blocks/view.ts');
    const { installBlockEffects } = await import('/src/lib/blocks/runtime.ts');
    const { sharedApp } = await import('/src/lib/obsidian/runtime.ts');
    const probe: any = { jobs: [], sharedApp };
    (window as any).effectProcessorProbe = probe;
    probe.stop = installBlockEffects(sharedApp);
    const host = document.createElement('div'); host.id = 'effect-processor-fixture'; document.body.prepend(host);
    probe.view = new EditorView({ parent: host, state: EditorState.create({ doc: '[async-transition]\nTarget source', extensions: [
      syntaxModel, blockModel, compositionSelection, livePreviewState, livePreviewReadonly.init(() => true),
      EditorState.readOnly.of(true), renderContext.of({ sourcePath: 'effect.md', allowScriptExecution: true, allowBlockEffects: true }), blockEffects,
    ] }) });
  });
  await page.waitForFunction(() => (window as any).effectProcessorProbe.jobs.length === 1);
  await page.evaluate(() => (window as any).effectProcessorProbe.jobs[0].finish('Stable block effect'));
  await expect(page.locator('#effect-processor-fixture .native-block-effect')).toHaveText('Stable block effect');
  await page.evaluate(() => (window as any).effectProcessorProbe.sharedApp.vault.trigger('modify', { path: 'dependency.md' }));
  await page.waitForFunction(() => (window as any).effectProcessorProbe.jobs.length === 2);
  const samples = await page.evaluate(() => new Promise<any[]>(resolve => {
    const samples: any[] = [];
    const frame = (time: number) => {
      const host = document.querySelector<HTMLElement>('#effect-processor-fixture .native-block-effect')!;
      samples.push({ time, text: host.innerText, pending: host.hasAttribute('data-render-pending') });
      if (samples.length < 8) requestAnimationFrame(frame); else resolve(samples);
    };
    requestAnimationFrame(frame);
  }));
  await writeFile(info.outputPath('effect-pending-frames.json'), JSON.stringify(samples, null, 2));
  await page.evaluate(() => (window as any).effectProcessorProbe.jobs[1].fail(new Error('controlled-effect-failure')));
  await expect(page.locator('#effect-processor-fixture .mod-error')).toContainText('controlled-effect-failure');
  expect(samples.every(sample => sample.text.includes('Stable block effect'))).toBe(true);
  await expect(page.locator('#effect-processor-fixture .native-block-effect')).toContainText('Stable block effect');
  expect(await page.evaluate(() => (window as any).effectProcessorProbe.view.state.doc.toString())).toBe('[async-transition]\nTarget source');
  await page.evaluate(() => (window as any).effectProcessorProbe.sharedApp.vault.trigger('modify', { path: 'dependency.md' }));
  await page.waitForFunction(() => (window as any).effectProcessorProbe.jobs.length === 3);
  await page.evaluate(() => (window as any).effectProcessorProbe.jobs[2].finish('Latest block effect'));
  await expect(page.locator('#effect-processor-fixture .native-block-effect')).toHaveText('Latest block effect');
  await page.evaluate(() => {
    const probe = (window as any).effectProcessorProbe;
    probe.sharedApp.vault.trigger('modify', { path: 'dependency.md' });
  });
  await page.waitForFunction(() => (window as any).effectProcessorProbe.jobs.length === 4);
  const disposal = await page.evaluate(async () => {
    const probe = (window as any).effectProcessorProbe, host = document.querySelector('#effect-processor-fixture .native-block-effect')!;
    probe.view.destroy(); probe.jobs[3].fail(new DOMException('late cancelled effect', 'AbortError'));
    await new Promise(resolve => setTimeout(resolve, 30));
    const result = { aborted: probe.jobs.map((job: any) => job.signal.aborted), pending: host.hasAttribute('data-render-pending'), text: host.textContent };
    probe.stop(); return result;
  });
  expect(disposal.aborted).toEqual([true, true, true, true]);
  expect(disposal.pending).toBe(false);
  expect(disposal.text).not.toContain('AbortError');
});

test('public MarkdownRenderer mounts actual formulas tables and images at nonzero width and replaces equal source', async ({ page }, info) => {
  await page.route('**/api/files/content?*', route => route.fulfill({ contentType: 'image/svg+xml', body:
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="48"><rect width="120" height="48" fill="royalblue"/></svg>',
  }));
  const raw = '# Actual rich fragment\n\n$$\\frac{a}{b}+\\sqrt{c}$$\n\n| Header | Second |\n| --- | --- |\n| Cell | Value |\n\n![fixture](processor-image.svg)\n\nTail';
  await page.evaluate(async raw => {
    const { MarkdownRenderer, sharedApp } = await import('/src/lib/obsidian/runtime.ts');
    const { Component } = await import('/src/lib/obsidian/events.ts');
    const owner = new Component(); await owner.load();
    const host = document.createElement('div'); host.id = 'public-rich-fixture'; host.style.width = '700px'; document.body.prepend(host);
    const probe: any = { owner, host, jobs: [], blocked: false, render: () => MarkdownRenderer.render(sharedApp, raw, host, 'rich.md', owner) };
    (window as any).publicProcessorProbe = probe;
    await probe.render();
  }, raw);
  const host = page.locator('#public-rich-fixture');
  await expect(host.locator('.cm-math-body svg')).toHaveCount(1);
  await expect(host.locator('.cm-table th').first()).toHaveText('Header');
  await expect(host.locator('.cm-table td').first()).toHaveText('Cell');
  await host.locator('img.cm-embed-image').evaluate((image: HTMLImageElement) => image.decode());
  await expect(host.locator('[data-render-pending]')).toHaveCount(0);
  const before = await host.locator('.cm-math-body svg').elementHandle();
  await page.evaluate(() => { const probe = (window as any).publicProcessorProbe; probe.blocked = true; probe.rendering = probe.render(); });
  await page.waitForFunction(() => (window as any).publicProcessorProbe.jobs.length === 1);
  await page.screenshot({ path: info.outputPath('public-rich-pending.png'), fullPage: true });
  expect(await before!.evaluate(node => node.isConnected)).toBe(true);
  await page.evaluate(() => (window as any).publicProcessorProbe.jobs[0].release());
  await page.evaluate(() => (window as any).publicProcessorProbe.rendering);
  await expect(host.locator('.cm-math-body svg')).toHaveCount(1);
  await expect(host.locator('.cm-table th').first()).toHaveText('Header');
  await expect(host.locator('.cm-table td').first()).toHaveText('Cell');
  await host.locator('img.cm-embed-image').evaluate((image: HTMLImageElement) => image.decode());
  await expect(host.locator('[data-render-pending]')).toHaveCount(0);
  const result = await host.evaluate(async host => {
    const { EditorView } = await import('/node_modules/.vite/deps/@codemirror_view.js');
    const svg = host.querySelector('svg')!, image = host.querySelector<HTMLImageElement>('img.cm-embed-image')!;
    return { width: svg.getBoundingClientRect().width, imageWidth: image.naturalWidth,
      source: EditorView.findFromDOM(host.querySelector('.cm-editor')!)!.state.doc.toString(),
      hidden: host.querySelectorAll('[hidden]').length };
  });
  expect(result.width).toBeGreaterThan(10); expect(result.imageWidth).toBe(120); expect(result.source).toBe(raw); expect(result.hidden).toBe(0);
  await page.screenshot({ path: info.outputPath('public-rich-ready.png'), fullPage: true });
  await page.evaluate(() => (window as any).publicProcessorProbe.owner.unload());
});

for (const change of ['source', 'path']) {
  test(`public MarkdownRenderer removes old document content when ${change} identity changes`, async ({ page }) => {
    const result = await page.evaluate(async change => {
      const { MarkdownRenderer, sharedApp } = await import('/src/lib/obsidian/runtime.ts');
      const { Component } = await import('/src/lib/obsidian/events.ts');
      const owner = new Component(); await owner.load();
      const host = document.createElement('div'); document.body.prepend(host);
      await MarkdownRenderer.render(sharedApp, 'Old private document', host, 'old.md', owner);
      const probe: any = { blocked: true, jobs: [] }; (window as any).publicProcessorProbe = probe;
      const rendering = MarkdownRenderer.render(sharedApp, change === 'source' ? 'New source text' : 'Old private document', host,
        change === 'path' ? 'different.md' : 'old.md', owner);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const result = { text: host.innerText, oldEditors: host.querySelectorAll('.cm-editor').length, pending: host.hasAttribute('data-render-pending') };
      probe.jobs[0].release(); await rendering; owner.unload(); return result;
    }, change);
    expect(result.text).not.toContain('Old private document');
    expect(result.text).toContain('正在渲染'); expect(result.oldEditors).toBe(0); expect(result.pending).toBe(true);
  });
}

test('public MarkdownRenderer synchronous mount failure rejects and releases pending owner and candidate DOM', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { MarkdownRenderer, sharedApp } = await import('/src/lib/obsidian/runtime.ts');
    const { Component } = await import('/src/lib/obsidian/events.ts');
    const owner = new Component(); await owner.load();
    const host = document.createElement('div'); document.body.prepend(host);
    await MarkdownRenderer.render(sharedApp, 'Stable output', host, 'sync.md', owner);
    const probe: any = { throwSync: true }; (window as any).publicProcessorProbe = probe;
    let error = '';
    try { await MarkdownRenderer.render(sharedApp, 'Stable output', host, 'sync.md', owner); }
    catch (caught) { error = (caught as Error).message; }
    const failed = { error, pending: host.hasAttribute('data-render-pending'), text: host.textContent,
      candidates: host.children.length, editors: host.querySelectorAll('.cm-editor').length };
    probe.throwSync = false;
    await MarkdownRenderer.render(sharedApp, 'Recovered output', host, 'sync.md', owner);
    const recovered = host.textContent; owner.unload(); return { failed, recovered };
  });
  expect(result.failed).toEqual({ error: 'controlled-public-sync-failure', pending: false, text: 'Stable output', candidates: 1, editors: 1 });
  expect(result.recovered).toBe('Recovered output');
});

test('native JavascriptBlock retains output during real watched-script refresh and failure', async ({ page }, info) => {
  const raw = '```js-widget\nwatch("dependency.md");\nawait new Promise((resolve, reject) => window.nativeProcessorProbe.jobs.push({ signal,\n  finish(label) { if (!signal.aborted) container.textContent = label; resolve(); }, fail: reject\n}));\n```';
  await page.evaluate(async raw => {
    const { EditorView } = await import('/node_modules/.vite/deps/@codemirror_view.js');
    const { EditorState } = await import('/node_modules/.vite/deps/@codemirror_state.js');
    const { syntaxModel, blockModel } = await import('/src/lib/syntaxModel.ts');
    const { compositionSelection } = await import('/src/lib/editorSelection.ts');
    const { livePreviewState, livePreviewReadonly } = await import('/src/lib/renderState.ts');
    const { renderContext } = await import('/src/lib/renderContext.ts');
    const { codeBlocks } = await import('/src/lib/obsidian/markdown.ts');
    const { installJavascript } = await import('/src/lib/javascript/runtime.ts');
    const { sharedApp } = await import('/src/lib/obsidian/runtime.ts');
    const probe: any = { jobs: [], sharedApp }; (window as any).nativeProcessorProbe = probe;
    probe.stop = installJavascript(sharedApp);
    const host = document.createElement('div'); host.id = 'native-processor-fixture'; document.body.prepend(host);
    probe.view = new EditorView({ parent: host, state: EditorState.create({ doc: raw, extensions: [
      syntaxModel, blockModel, compositionSelection, livePreviewState, livePreviewReadonly.init(() => true),
      EditorState.readOnly.of(true), renderContext.of({ sourcePath: 'native.md', allowScriptExecution: true }), codeBlocks,
    ] }) });
  }, raw);
  await page.waitForFunction(() => (window as any).nativeProcessorProbe.jobs.length === 1);
  const sample = () => page.evaluate(() => new Promise<any[]>(resolve => {
    const samples: any[] = [];
    const frame = (time: number) => {
      const host = document.querySelector<HTMLElement>('#native-processor-fixture .interactive-js-render')!;
      samples.push({ time, text: host.innerText, pending: host.hasAttribute('data-render-pending'), height: host.getBoundingClientRect().height });
      if (samples.length < 8) requestAnimationFrame(frame); else resolve(samples);
    };
    requestAnimationFrame(frame);
  }));
  const cold = await sample();
  await page.evaluate(() => (window as any).nativeProcessorProbe.jobs[0].finish('Stable native script output'));
  await expect(page.locator('#native-processor-fixture .interactive-js-output')).toHaveText('Stable native script output');
  await page.evaluate(() => (window as any).nativeProcessorProbe.sharedApp.vault.trigger('modify', { path: 'dependency.md' }));
  await page.waitForFunction(() => (window as any).nativeProcessorProbe.jobs.length === 2);
  const samples = await sample();
  await writeFile(info.outputPath('native-js-frames.json'), JSON.stringify({ cold, samples }, null, 2));
  await page.evaluate(() => (window as any).nativeProcessorProbe.jobs[1].fail(new Error('controlled-native-js-failure')));
  await expect(page.locator('#native-processor-fixture .interactive-js-error')).toContainText('controlled-native-js-failure');
  expect(cold.every(sample => Boolean(sample.text.trim()))).toBe(true);
  expect(samples.every(sample => sample.text.includes('Stable native script output'))).toBe(true);
  await expect(page.locator('#native-processor-fixture .interactive-js-output')).toHaveText('Stable native script output');
  expect(await page.evaluate(() => (window as any).nativeProcessorProbe.view.state.doc.toString())).toBe(raw);
  await page.evaluate(() => (window as any).nativeProcessorProbe.sharedApp.vault.trigger('modify', { path: 'dependency.md' }));
  await page.waitForFunction(() => (window as any).nativeProcessorProbe.jobs.length === 3);
  await page.evaluate(() => (window as any).nativeProcessorProbe.jobs[2].finish('Newest native output'));
  await expect(page.locator('#native-processor-fixture .interactive-js-output')).toHaveText('Newest native output');
  await page.evaluate(() => (window as any).nativeProcessorProbe.sharedApp.vault.trigger('modify', { path: 'dependency.md' }));
  await page.waitForFunction(() => (window as any).nativeProcessorProbe.jobs.length === 4);
  await page.evaluate(() => (window as any).nativeProcessorProbe.sharedApp.vault.trigger('modify', { path: 'dependency.md' }));
  await page.waitForFunction(() => (window as any).nativeProcessorProbe.jobs.length === 5);
  expect(await page.evaluate(() => (window as any).nativeProcessorProbe.jobs[3].signal.aborted)).toBe(true);
  await page.evaluate(() => (window as any).nativeProcessorProbe.jobs[4].finish('Final native output'));
  await page.evaluate(() => (window as any).nativeProcessorProbe.jobs[3].fail(new Error('obsolete-native-error')));
  await expect(page.locator('#native-processor-fixture .interactive-js-output')).toHaveText('Final native output');
  await expect(page.locator('#native-processor-fixture .interactive-js-error')).toHaveCount(0);
  await page.evaluate(() => (window as any).nativeProcessorProbe.sharedApp.vault.trigger('modify', { path: 'dependency.md' }));
  await page.waitForFunction(() => (window as any).nativeProcessorProbe.jobs.length === 6);
  const disposed = await page.evaluate(async () => {
    const probe = (window as any).nativeProcessorProbe;
    probe.view.destroy(); probe.jobs[5].fail(new DOMException('cancelled native fixture', 'AbortError'));
    await new Promise(resolve => setTimeout(resolve, 30));
    probe.stop(); return { aborted: probe.jobs.map((job: any) => job.signal.aborted),
      errors: document.querySelectorAll('#native-processor-fixture .interactive-js-error').length };
  });
  expect(disposed).toEqual({ aborted: [true, true, true, true, true, true], errors: 0 });
});
