import { test, expect } from './test';
import type { Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const diagram = (label: string, prefix = '') => `${prefix}\`\`\`mermaid\n${prefix}flowchart TD\n${prefix}A[${label}] --> B[目标]\n${prefix}\`\`\``;

async function tick(page: Page, count = 8) {
  await page.evaluate(count => new Promise<void>(resolve => {
    const next = () => { if (--count) requestAnimationFrame(next); else resolve(); };
    requestAnimationFrame(next);
  }), count);
}

async function open(page: Page, source: string) {
  await page.route('**/src/components/MarkdownFragment.tsx*', async route => {
    const response = await route.fetch();
    const body = await response.text();
    const marker = 'export function mountMarkdownFragment(host, source, options) {';
    if (!body.includes(marker)) throw new Error('Fragment mount instrumentation no longer matches');
    await route.fulfill({ response, body: body.replace(marker, `${marker}
      const gate = window.mediaGate;
      if (gate?.kind === 'preview' && options.id.endsWith('#preview')) {
        if (gate.failure) throw new Error('controlled-preview-mount-failure');
        if (gate.pendingLayout) {
          const job = { host, source, mounted: false, resolve() { options.onReady?.(); } };
          gate.jobs.push(job);
          return actualMount(host, source, { ...options, onReady() { job.mounted = true; } });
        }
        if (gate.blocked) {
          let stop;
          const job = { source, host, cancelled: false, ready: options.onReady,
            resolve() { stop = actualMount(host, source, options); },
            reject() { options.onError?.(new Error('controlled-preview-mount-failure')); } };
          gate.jobs.push(job);
          return () => { job.cancelled = true; stop?.(); };
        }
      }
      if (gate?.kind === 'embed' && gate.failure) throw new Error('controlled-embed-mount-failure');
      if (gate?.kind === 'embed' && gate.missing) return;
      if (gate?.kind === 'embed' && gate.pendingLayout && host.classList.contains('cm-note-fragment')) {
        const job = { host, source, mounted: false, resolve() { options.onReady?.(); } };
        gate.jobs.push(job);
        return actualMount(host, source, { ...options, onReady() { job.mounted = true; } });
      }
      if (gate?.kind === 'embed' && gate.blocked && host.classList.contains('cm-note-fragment')) {
        let stop;
        const job = { source, host, cancelled: false, ready: options.onReady,
          resolve() { stop = actualMount(host, source, options); },
          reject() { options.onError?.(new Error('controlled-embed-mount-failure')); } };
        gate.jobs.push(job);
        return () => { job.cancelled = true; stop?.(); };
      }
      return actualMount(host, source, options);
    }
    function actualMount(host, source, options) {
      (window.mediaMounted ||= []).push({ host, source, mode: options.mode, context: options.context, reject() { options.onError?.(new Error('old-fragment-error')); } });`) });
  });
  await page.goto('/__render-test');
  await page.waitForFunction(() => Boolean(window.renderHarness));
  await page.evaluate(raw => window.renderHarness.reset(raw), source);
  await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe(source);
  await page.evaluate(() => window.renderHarness.cursor(0, window.renderHarness.source(0).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').length));
  await expect(page.locator('[data-render-pending]')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  await tick(page, 3);
}

async function mermaidGate(page: Page) {
  await page.evaluate(async () => {
    const script = await (await fetch('/src/lib/livePreview.ts')).text();
    const url = script.match(/import\("([^"]*\/mermaid\.js[^\"]*)"\)/)?.[1];
    if (!url) throw new Error('Mermaid module import was not found');
    const mermaid = (await import(/* @vite-ignore */ url)).default;
    const render = mermaid.render.bind(mermaid);
    const gate = { blocked: true, jobs: [] as any[] };
    (window as any).mediaGate = gate;
    mermaid.render = async (...args: Parameters<typeof render>) => {
      if (gate.blocked) await new Promise<void>((resolve, reject) => gate.jobs.push({ code: args[1], resolve, reject }));
      return render(...args);
    };
  });
}

async function embedGate(page: Page) {
  await page.evaluate(() => {
    (window as any).mediaGate = { kind: 'embed', blocked: true, jobs: [] as any[] };
  });
}

async function frames(page: Page, start = false) {
  return page.evaluate(start => {
    if (start) {
      const probe = { running: true, samples: [] as any[] };
      (window as any).mediaFrames = probe;
      const sample = (time: number) => {
        probe.samples.push({ time, hosts: [...document.querySelectorAll<HTMLElement>('.cm-mermaid,.cm-note-embed,.cm-link-preview-body')].map(host => {
          const rect = host.getBoundingClientRect();
          return { slot: host.closest('[data-slot]')?.getAttribute('data-slot'), kind: host.classList.contains('cm-mermaid') ? 'mermaid' : host.classList.contains('cm-note-embed') ? 'embed' : 'preview',
            text: host.textContent, svg: host.querySelectorAll(':scope > div > svg').length,
            fragments: host.querySelectorAll('.cm-note-fragment .cm-editor').length,
            height: rect.height, pending: host.hasAttribute('data-render-pending'), error: host.classList.contains('mod-error') };
        }) });
        if (probe.running) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    } else (window as any).mediaFrames.running = false;
    return (window as any).mediaFrames.samples as { time: number; hosts: { slot: string; kind: string; text: string; svg: number; fragments: number; height: number; pending: boolean; error: boolean }[] }[];
  }, start);
}

for (const prefix of ['', '> ']) test(`Mermaid delayed update retains successful SVG and height ${prefix ? 'inside quote' : 'at root'}`, async ({ page }, info) => {
  const source = `前言\n\n${diagram('原图', prefix)}\n\n末尾`;
  await open(page, source);
  await expect(page.locator('.cm-mermaid > div > svg')).toHaveCount(2);
  const heights = await page.locator('.cm-mermaid').evaluateAll(hosts => hosts.map(host => host.getBoundingClientRect().height));
  await mermaidGate(page); await frames(page, true);
  await page.evaluate(() => {
    const from = window.renderHarness.source(0).indexOf('原图');
    window.renderHarness.edit(0, [{ from, to: from + 2, insert: '新图' }]);
  });
  await expect.poll(() => page.evaluate(() => (window as any).mediaGate.jobs.length)).toBe(2);
  await tick(page, 14);
  const samples = await frames(page);
  await writeFile(info.outputPath('delayed-update-frames.json'), JSON.stringify(samples, null, 2));
  await page.screenshot({ path: info.outputPath('delayed-update.png'), fullPage: true });
  const pending = samples.flatMap(frame => frame.hosts).filter(host => host.pending);
  expect(pending.length).toBeGreaterThan(10);
  expect(pending.every(host => host.svg === 1 && host.text.includes('原图'))).toBe(true);
  expect(pending.every(host => Math.abs(host.height - heights[Number(host.slot)]) < 1)).toBe(true);
  await page.evaluate(() => { const gate = (window as any).mediaGate; gate.blocked = false; gate.jobs.forEach((job: any) => job.resolve()); });
  await expect(page.locator('[data-render-pending]')).toHaveCount(0);
  await expect(page.locator('.cm-mermaid .nodeLabel')).toHaveText(['新图', '目标', '新图', '目标']);
  await page.evaluate(() => window.renderHarness.undo(0));
  await expect(page.locator('.cm-mermaid .nodeLabel')).toHaveText(['原图', '目标', '原图', '目标']);
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
  expect(await page.evaluate(() => window.renderHarness.writes)).toEqual([]);
});

test('Mermaid stale completion and rejection cannot overwrite the latest pending render', async ({ page }, info) => {
  const source = `前言\n\n${diagram('原图')}\n\n末尾`;
  await open(page, source); await mermaidGate(page);
  for (const next of ['中图', '终图']) {
    await page.evaluate(next => {
      const raw = window.renderHarness.source(0), from = raw.indexOf('A[') + 2;
      window.renderHarness.edit(0, [{ from, to: from + 2, insert: next }]);
    }, next);
    await expect.poll(() => page.evaluate(() => (window as any).mediaGate.jobs.length)).toBe(next === '中图' ? 2 : 4);
  }
  await page.evaluate(() => { const jobs = (window as any).mediaGate.jobs; jobs[0].resolve(); jobs[1].reject(new Error('cancelled-old-render')); });
  await tick(page);
  await expect(page.locator('.cm-mermaid[data-render-pending]')).toHaveCount(2);
  await expect(page.locator('.cm-mermaid.mod-error')).toHaveCount(0);
  await expect(page.locator('.cm-mermaid .nodeLabel')).toHaveText(['原图', '目标', '原图', '目标']);
  await page.evaluate(() => { const gate = (window as any).mediaGate; gate.blocked = false; gate.jobs.slice(2).forEach((job: any) => job.resolve()); });
  await expect(page.locator('[data-render-pending]')).toHaveCount(0);
  await expect(page.locator('.cm-mermaid .nodeLabel')).toHaveText(['终图', '目标', '终图', '目标']);
  await page.screenshot({ path: info.outputPath('latest-render.png'), fullPage: true });
});

test('Mermaid current failure retains the previous image and recovers on the next source change', async ({ page }, info) => {
  const source = `前言\n\n${diagram('原图')}\n\n末尾`;
  await open(page, source); await mermaidGate(page);
  await page.evaluate(() => { const from = window.renderHarness.source(0).indexOf('原图'); window.renderHarness.edit(0, [{ from, to: from + 2, insert: '错图' }]); });
  await expect.poll(() => page.evaluate(() => (window as any).mediaGate.jobs.length)).toBe(2);
  await page.evaluate(() => (window as any).mediaGate.jobs.forEach((job: any) => job.reject(new Error('controlled-diagram-failure'))));
  await expect(page.locator('.cm-mermaid.mod-error')).toHaveCount(2);
  await expect(page.locator('.cm-mermaid > div > svg')).toHaveCount(2);
  await expect(page.locator('.cm-mermaid [role="alert"]')).toHaveText(['图表渲染失败', '图表渲染失败']);
  await page.screenshot({ path: info.outputPath('retained-error.png'), fullPage: true });
  await page.evaluate(() => { (window as any).mediaGate.blocked = false; window.renderHarness.undo(0); });
  await expect(page.locator('.cm-mermaid.mod-error')).toHaveCount(0);
  await expect(page.locator('[data-render-pending]')).toHaveCount(0);
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
});

test('embed delayed refresh keeps rendered content until the newest fragment is ready', async ({ page }, info) => {
  const source = '\uFEFF前言\r\n\r\n![[b]]\r\n\r\n末尾';
  await open(page, source.replace('![[b]]', '占位'));
  await page.evaluate(raw => { window.renderHarness.notes({ 'b.md': '# 标题\n\n**旧正文**' }); window.renderHarness.reset(raw); }, source);
  await expect(page.locator('.cm-note-embed .cm-strong')).toHaveText(['旧正文', '旧正文']);
  await embedGate(page); await frames(page, true);
  await page.evaluate(() => window.renderHarness.changeNote('b.md', '# 标题\n\n**中正文**'));
  await expect.poll(() => page.evaluate(() => (window as any).mediaGate.jobs.length)).toBe(2);
  await page.evaluate(() => window.renderHarness.changeNote('b.md', '# 标题\n\n**终正文**'));
  await expect.poll(() => page.evaluate(() => (window as any).mediaGate.jobs.length)).toBe(4);
  await page.evaluate(() => (window as any).mediaMounted.filter((job: any) => job.host.isConnected && job.source.includes('旧正文')).forEach((job: any) => job.reject()));
  await expect(page.locator('.cm-note-embed[data-render-pending]')).toHaveCount(2);
  await tick(page, 14);
  const samples = await frames(page);
  await writeFile(info.outputPath('embed-refresh-frames.json'), JSON.stringify(samples, null, 2));
  await page.screenshot({ path: info.outputPath('embed-refresh-pending.png'), fullPage: true });
  expect(samples.flatMap(frame => frame.hosts).every(host => host.text.includes('旧正文') && host.height > 20)).toBe(true);
  await page.evaluate(() => { const jobs = (window as any).mediaGate.jobs; jobs[2].resolve(); jobs[3].resolve(); });
  await expect(page.locator('.cm-note-embed .cm-strong')).toHaveText(['终正文', '终正文']);
  await page.evaluate(() => { const jobs = (window as any).mediaGate.jobs; jobs[0].ready?.(); jobs[1].ready?.(); });
  await tick(page);
  await expect(page.locator('.cm-note-embed .cm-strong')).toHaveText(['终正文', '终正文']);
  await expect(page.locator('[data-render-pending]')).toHaveCount(0);
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
  expect(await page.evaluate(() => window.renderHarness.writes)).toEqual([]);
});

test('embed cancelled refresh cannot mount after its owning view closes', async ({ page }) => {
  await open(page, '前言\n\n占位\n\n末尾');
  await page.evaluate(() => { window.renderHarness.notes({ 'b.md': '**旧正文**' }); window.renderHarness.reset('前言\n\n![[b]]\n\n末尾'); });
  await expect(page.locator('.cm-note-embed .cm-strong')).toHaveCount(2);
  await embedGate(page);
  await page.evaluate(() => window.renderHarness.changeNote('b.md', '**取消正文**'));
  await expect.poll(() => page.evaluate(() => (window as any).mediaGate.jobs.length)).toBe(2);
  await page.evaluate(() => { (window as any).mediaRoots = [...document.querySelectorAll('.cm-note-embed')]; window.renderHarness.reset('新页面'); });
  await expect(page.locator('.cm-note-embed')).toHaveCount(0);
  await page.evaluate(() => (window as any).mediaGate.jobs.forEach((job: any) => job.ready?.()));
  await tick(page);
  expect(await page.evaluate(() => ({
    cancelled: (window as any).mediaGate.jobs.every((job: any) => job.cancelled),
    pending: (window as any).mediaRoots.some((root: HTMLElement) => root.hasAttribute('data-render-pending')),
  }))).toEqual({ cancelled: true, pending: false });
});

for (const failure of ['synchronous', 'asynchronous']) test(`embed ${failure} refresh failure retains rendered content and recovers`, async ({ page }, info) => {
  const source = '前言\n\n![[b]]\n\n末尾';
  await open(page, '占位');
  await page.evaluate(raw => { window.renderHarness.notes({ 'b.md': '**旧正文**' }); window.renderHarness.reset(raw); }, source);
  await expect(page.locator('.cm-note-embed .cm-strong')).toHaveText(['旧正文', '旧正文']);
  await embedGate(page);
  await page.evaluate(failure => {
    (window as any).mediaGate.failure = failure === 'synchronous';
    window.renderHarness.changeNote('b.md', '**失败正文**');
  }, failure);
  if (failure === 'asynchronous') {
    await expect.poll(() => page.evaluate(() => (window as any).mediaGate.jobs.length)).toBe(2);
    await page.evaluate(() => (window as any).mediaGate.jobs.forEach((job: any) => job.reject()));
  }
  await expect(page.locator('.cm-note-embed [role="alert"]')).toHaveText(['无法加载嵌入内容', '无法加载嵌入内容']);
  await expect(page.locator('.cm-note-embed .cm-strong')).toHaveText(['旧正文', '旧正文']);
  await expect(page.locator('[data-render-pending]')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('embed-retained-failure.png'), fullPage: true });
  await page.evaluate(() => {
    const gate = (window as any).mediaGate; gate.failure = false; gate.blocked = false;
    window.renderHarness.changeNote('b.md', '**恢复正文**');
  });
  await expect(page.locator('.cm-note-embed .cm-strong')).toHaveText(['恢复正文', '恢复正文']);
  await expect(page.locator('.cm-note-embed [role="alert"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
  expect(await page.evaluate(() => window.renderHarness.writes)).toEqual([]);
});

test('missing embed renderer presents an error instead of raw Markdown', async ({ page }, info) => {
  const raw = '# SECRET_RAW_HEADING\n\n**SECRET_RAW_MARKUP** $x+y$';
  await open(page, '占位'); await embedGate(page);
  await page.evaluate(raw => {
    (window as any).mediaGate.missing = true;
    window.renderHarness.notes({ 'b.md': raw }); window.renderHarness.reset('前言\n\n![[b]]\n\n末尾');
  }, raw);
  await expect(page.locator('.cm-note-embed [role="alert"]')).toHaveText(['无法加载嵌入内容', '无法加载嵌入内容']);
  await expect(page.locator('.cm-note-embed')).not.toContainText(['SECRET_RAW', 'SECRET_RAW']);
  await expect(page.locator('[data-render-pending]')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('missing-renderer.png'), fullPage: true });
});

test('embed deleted section and restoration clear pending state and remeasure the outer document', async ({ page }) => {
  const source = '前言\n\n![[b#节]]\n\n末尾';
  await open(page, '占位');
  await page.evaluate(raw => { window.renderHarness.notes({ 'b.md': '# 节\n\n**原正文**' }); window.renderHarness.reset(raw); }, source);
  await expect(page.locator('.cm-note-embed .cm-strong')).toHaveText(['原正文', '原正文']);
  await page.evaluate(() => window.renderHarness.changeNote('b.md', '# 删除的节\n\n正文'));
  await expect(page.locator('.markdown-embed-content')).toHaveText(['找不到嵌入的章节或块', '找不到嵌入的章节或块']);
  await expect(page.locator('[data-render-pending]')).toHaveCount(0);
  await page.evaluate(() => window.renderHarness.changeNote('b.md', '# 节\n\n**原正文**'));
  await expect(page.locator('.cm-note-embed .cm-strong')).toHaveText(['原正文', '原正文']);
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
});

test('Mermaid native source controls retain editable source and exact Undo', async ({ page }, info) => {
  const source = `前言\n\n${diagram('原图')}\n\n末尾`;
  await open(page, source);
  await page.evaluate(() => window.renderHarness.edit(0, [{ from: 0, to: 0, insert: '新增前言\n\n' }]));
  await page.locator('[data-slot="0"] .cm-mermaid .cm-source-toggle').click();
  await expect(page.locator('[data-slot="0"] .cm-content')).toContainText('flowchart TD');
  await expect(page.locator('[data-slot="0"] .cm-mermaid')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('native-mermaid-source.png'), fullPage: true });
  await writeFile(info.outputPath('native-mermaid-source.html'), await page.locator('[data-slot="0"] .cm-content').innerHTML());
  await page.evaluate(() => { const from = window.renderHarness.source(0).indexOf('原图'); window.renderHarness.cursor(0, from, from + 2); window.renderHarness.focus(0); });
  await page.keyboard.insertText('输入');
  await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe('新增前言\n\n' + source.replace('原图', '输入'));
  await page.evaluate(() => window.renderHarness.undo(0));
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe('新增前言\n\n' + source);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-slot="0"] .cm-mermaid .nodeLabel')).toHaveText(['原图', '目标']);
  await page.evaluate(() => window.renderHarness.undo(0));
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
  expect(await page.evaluate(() => window.renderHarness.writes)).toEqual([]);
});

for (const prefix of ['', '> ']) test(`narrow embed stages actual long math and table at its final host width ${prefix ? 'inside quote' : 'at root'}`, async ({ page }, info) => {
  const source = `前言\n\n${prefix}![[b]]\n\n末尾`;
  const tex = String.raw`\frac{\mathrm d}{\mathrm da}\langle f\rangle_a=\int f(x)\,\partial_a\rho(x-a)\,\mathrm dx=-\int f\,\rho'\,\mathrm dx=\int f'\,\rho\,\mathrm dx=\langle f'\rangle_a`;
  const columns = Array.from({ length: 6 }, (_, index) => `UnbreakableColumn${index}Contents`);
  const table = `| ${columns.join(' | ')} |\n| ${columns.map(() => '---').join(' | ')} |\n| ${columns.map((_, index) => `LongValue${index}NoBreak`).join(' | ')} |`;
  const embedded = `# 嵌入宽度\n\n$$${tex}$$\n\n${table}\n\n**新正文**`;
  await open(page, '占位');
  await page.evaluate(raw => {
    document.documentElement.style.setProperty('--file-line-width', '360px');
    window.renderHarness.notes({ 'b.md': '**旧正文**' }); window.renderHarness.reset(raw);
  }, source);
  await expect(page.locator('.cm-note-embed .cm-strong')).toHaveText(['旧正文', '旧正文']);
  await page.evaluate(() => { for (const section of document.querySelectorAll<HTMLElement>('[data-slot]')) section.style.width = '384px'; });
  await page.evaluate(embedded => {
    (window as any).mediaGate = { kind: 'embed', pendingLayout: true, jobs: [] };
    window.renderHarness.changeNote('b.md', embedded);
  }, embedded);
  await expect.poll(() => page.evaluate(() => (window as any).mediaGate.jobs.filter((job: any) => job.mounted).length)).toBe(2);
  await expect(page.locator('.cm-note-embed .cm-math-body svg')).toHaveCount(2);
  await expect(page.locator('.cm-note-embed .cm-table-wrap table')).toHaveCount(2);
  await expect(page.locator('.cm-note-embed .cm-math-rendered[data-render-pending]')).toHaveCount(0);
  await tick(page, 10);
  const metrics = () => page.evaluate(async () => {
    const { readMathMetrics } = await import('/src/lib/mathjax.ts');
    return (window as any).mediaGate.jobs.map((job: any) => {
      const host: HTMLElement = job.host, body = host.querySelector<HTMLElement>('.cm-math-body')!;
      const math = body.closest<HTMLElement>('.cm-math-rendered')!, table = host.querySelector<HTMLElement>('table')!;
      const column = host.closest<HTMLElement>('[data-slot]')!.querySelector<HTMLElement>('.cm-content')!;
      return { host: host.clientWidth, content: host.parentElement!.clientWidth, box: host.closest<HTMLElement>('.cm-note-embed')!.clientWidth,
        editorContent: host.querySelector<HTMLElement>('.cm-content')!.clientWidth, column: column.clientWidth,
        table: table.clientWidth, formula: math.clientWidth, metrics: readMathMetrics(body, math.parentElement),
        position: getComputedStyle(host).position, visibility: getComputedStyle(host).visibility, height: host.clientHeight };
    });
  });
  const pending = await metrics();
  await page.screenshot({ path: info.outputPath('narrow-pending.png'), fullPage: true });
  await page.evaluate(() => (window as any).mediaGate.jobs.forEach((job: any) => job.resolve()));
  await expect(page.locator('.cm-note-embed[data-render-pending]')).toHaveCount(0);
  await expect(page.locator('.cm-note-embed .cm-strong')).toHaveText(['新正文', '新正文']);
  await tick(page, 10);
  const committed = await metrics();
  await writeFile(info.outputPath('narrow-layout-metrics.json'), JSON.stringify({ pending, committed }, null, 2));
  await page.screenshot({ path: info.outputPath('narrow-committed.png'), fullPage: true });
  for (const [index, before] of pending.entries()) {
    expect(before.column).toBeLessThan(400);
    expect(before.host).toBe(committed[index].host);
    expect(before.host).toBe(before.content);
    expect(before.editorContent).toBe(committed[index].editorContent);
    expect(before.metrics.containerWidth).toBe(committed[index].metrics.containerWidth);
    expect(before.table).toBe(committed[index].table);
    expect(before.formula).toBe(committed[index].formula);
    expect(before.visibility).toBe('hidden');
  }
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
  expect(await page.evaluate(() => window.renderHarness.writes)).toEqual([]);
});

async function openPreview(page: Page) {
  const source = '前言\n\n[[b#节]]\n\n末尾';
  await open(page, '占位');
  await page.evaluate(raw => { window.renderHarness.notes({ 'b.md': '# 节\n\n**旧预览**' }); window.renderHarness.reset(raw); }, source);
  await page.locator('[data-slot="1"] [data-preview-link]').hover();
  await expect(page.locator('.cm-link-preview .cm-strong')).toHaveText('旧预览');
  await page.locator('.cm-link-preview').hover();
  await page.evaluate(() => { (window as any).mediaGate = { kind: 'preview', blocked: true, jobs: [] }; });
  return source;
}

test('external link preview retains its body during delayed note refresh and discards old callbacks', async ({ page }, info) => {
  const source = await openPreview(page);
  await frames(page, true);
  for (const text of ['中预览', '终预览']) {
    await page.evaluate(text => window.renderHarness.changeNote('b.md', '# 节\n\n**' + text + '**'), text);
    await expect.poll(() => page.evaluate(() => (window as any).mediaGate.jobs.length)).toBe(text === '中预览' ? 1 : 2);
  }
  await page.evaluate(() => (window as any).mediaMounted.filter((job: any) => job.host.closest('.cm-link-preview') && job.source.includes('旧预览')).forEach((job: any) => job.reject()));
  await tick(page, 14);
  const samples = await frames(page);
  await writeFile(info.outputPath('external-preview-refresh-frames.json'), JSON.stringify(samples, null, 2));
  await page.screenshot({ path: info.outputPath('external-preview-pending.png'), fullPage: true });
  const hosts = samples.flatMap(sample => sample.hosts).filter(host => host.kind === 'preview');
  expect(hosts.length).toBeGreaterThan(10);
  expect(hosts.every(host => host.text.includes('旧预览') && host.height > 20)).toBe(true);
  await page.evaluate(() => (window as any).mediaGate.jobs[1].resolve());
  await expect(page.locator('.cm-link-preview .cm-strong')).toHaveText('终预览');
  await page.evaluate(() => { const job = (window as any).mediaGate.jobs[0]; job.ready?.(); job.reject(); });
  await tick(page);
  await expect(page.locator('.cm-link-preview .cm-strong')).toHaveText('终预览');
  await expect(page.locator('.cm-link-preview [role="alert"]')).toHaveCount(0);
  await expect(page.locator('.cm-link-preview [data-render-pending]')).toHaveCount(0);
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
  expect(await page.evaluate(() => window.renderHarness.writes)).toEqual([]);
});

for (const failure of ['synchronous', 'asynchronous']) test(`external link preview ${failure} failure retains previous body and visibly recovers`, async ({ page }, info) => {
  await openPreview(page);
  await page.evaluate(failure => { (window as any).mediaGate.failure = failure === 'synchronous'; window.renderHarness.changeNote('b.md', '# 节\n\n**错误预览**'); }, failure);
  if (failure === 'asynchronous') {
    await expect.poll(() => page.evaluate(() => (window as any).mediaGate.jobs.length)).toBe(1);
    await page.evaluate(() => (window as any).mediaGate.jobs[0].reject());
  }
  await expect(page.locator('.cm-link-preview [role="alert"]')).toContainText('预览失败');
  await expect(page.locator('.cm-link-preview .cm-strong')).toHaveText('旧预览');
  await expect(page.locator('.cm-link-preview [data-render-pending]')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('external-preview-error.png'), fullPage: true });
  await page.evaluate(() => { const gate = (window as any).mediaGate; gate.failure = false; gate.blocked = false; window.renderHarness.changeNote('b.md', '# 节\n\n**恢复预览**'); });
  await expect(page.locator('.cm-link-preview .cm-strong')).toHaveText('恢复预览');
  await expect(page.locator('.cm-link-preview [role="alert"]')).toHaveCount(0);
});

test('external link preview cancellation releases refresh and ignores late callbacks', async ({ page }) => {
  const source = await openPreview(page);
  await page.evaluate(() => window.renderHarness.changeNote('b.md', '# 节\n\n**取消预览**'));
  await expect.poll(() => page.evaluate(() => (window as any).mediaGate.jobs.length)).toBe(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.cm-link-preview')).toHaveCount(0);
  await page.evaluate(() => { const job = (window as any).mediaGate.jobs[0]; job.ready?.(); job.reject(); window.renderHarness.changeNote('b.md', '# 节\n\n**关闭后预览**'); });
  await tick(page);
  expect(await page.evaluate(() => ({ count: (window as any).mediaGate.jobs.length, cancelled: (window as any).mediaGate.jobs[0].cancelled }))).toEqual({ count: 1, cancelled: true });
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
});

test('external link preview stages actual math at final width and retains non-executing readonly context', async ({ page }, info) => {
  const source = await openPreview(page);
  await page.evaluate(() => {
    (window as any).mediaGate = { kind: 'preview', pendingLayout: true, jobs: [] };
    window.renderHarness.changeNote('b.md', '# 节\n\n$$\\frac{a+b+c+d+e+f+g+h+i+j+k+l}{x+y+z}=\\int_0^\\infty f(x)\\,dx$$\n\n| Left | Right |\n| --- | --- |\n| One | Two |');
  });
  await expect.poll(() => page.evaluate(() => (window as any).mediaGate.jobs.filter((job: any) => job.mounted).length)).toBe(1);
  await expect(page.locator('.cm-link-preview .cm-math-body svg')).toHaveCount(1);
  await expect(page.locator('.cm-link-preview .cm-table-wrap table')).toHaveCount(1);
  await expect(page.locator('.cm-link-preview .cm-math-rendered[data-render-pending]')).toHaveCount(0);
  await tick(page);
  const metrics = () => page.evaluate(async () => {
    const { readMathMetrics } = await import('/src/lib/mathjax.ts');
    const job = (window as any).mediaGate.jobs[0], host: HTMLElement = job.host;
    const body = host.querySelector<HTMLElement>('.cm-math-body')!, math = body.closest<HTMLElement>('.cm-math-rendered')!;
    const mounted = (window as any).mediaMounted.find((mount: any) => mount.host === host);
    return { width: host.clientWidth, parent: host.parentElement!.clientWidth, metrics: readMathMetrics(body, math.parentElement).containerWidth,
      height: host.clientHeight, mode: mounted.mode, script: mounted.context.allowScriptExecution,
      plugins: mounted.context.allowPlugins, html: mounted.context.allowHtmlExecution, navigation: mounted.context.navigationId };
  });
  const pending = await metrics();
  await page.screenshot({ path: info.outputPath('preview-real-math-pending.png'), fullPage: true });
  await page.evaluate(() => (window as any).mediaGate.jobs[0].resolve());
  await expect(page.locator('.cm-link-preview-body[data-render-pending]')).toHaveCount(0);
  await tick(page);
  const committed = await metrics();
  await writeFile(info.outputPath('preview-layout-metrics.json'), JSON.stringify({ pending, committed }, null, 2));
  await page.screenshot({ path: info.outputPath('preview-real-math-committed.png'), fullPage: true });
  expect(pending.width).toBe(committed.width);
  expect(pending.width).toBe(pending.parent);
  expect(pending.metrics).toBe(committed.metrics);
  expect(pending.height).toBe(0);
  expect(pending).toMatchObject({ mode: 'reading', script: false, plugins: false, html: false });
  expect(pending.navigation).toBeUndefined();
  await page.evaluate(() => window.renderHarness.changeNote('b.md', '# 另一个节\n\n没有目标'));
  await expect(page.locator('.cm-link-preview-body')).toHaveText('未找到链接目标');
  await expect(page.locator('.cm-link-preview [data-render-pending]')).toHaveCount(0);
  await page.evaluate(() => { (window as any).mediaGate = undefined; window.renderHarness.changeNote('b.md', '# 节\n\n**恢复目标**'); });
  await expect(page.locator('.cm-link-preview .cm-strong')).toHaveText('恢复目标');
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
});
