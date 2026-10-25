import { test, expect } from './test';
import type { Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const longTex = String.raw`\frac{\mathrm d}{\mathrm da}\langle f\rangle_a=\int f(x)\,\partial_a\rho(x-a)\,\mathrm dx=-\int f\,\rho'\,\mathrm dx=\int f'\,\rho\,\mathrm dx=\langle f'\rangle_a`;
const source = `# Transition\n\n$$${longTex}$$ ^eq-transition\n\nTail`;

async function open(page: Page, raw = source, fail = false) {
  await page.goto('/__render-test');
  await page.waitForFunction(() => Boolean(window.renderHarness));
  await page.evaluate(async fail => {
    const { loadMathJax } = await import('/src/lib/mathjax.ts');
    const runtime = await loadMathJax();
    const factory = runtime.startup.mathjax.document;
    const probe = { blocked: false, release: () => {}, conversions: 0, entered: 0, fail };
    (window as any).transitionGate = probe;
    runtime.startup.mathjax.document = function (...args: Parameters<typeof factory>) {
      const engine = factory.apply(this, args), convert = engine.convertPromise;
      engine.convertPromise = async function (tex, options) {
        if (tex !== '\\begingroupSandbox') {
          probe.conversions++;
          if (probe.blocked) await new Promise<void>(resolve => { probe.entered++; probe.release = resolve; });
          if (probe.fail) throw new Error('controlled-transition-failure');
        }
        return convert.call(this, tex, options);
      };
      return engine;
    };
  }, fail);
  await page.evaluate(source => window.renderHarness.reset(source), raw);
  await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe(raw);
  await page.evaluate(() => window.renderHarness.cursor(0, window.renderHarness.source(0).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').length));
  await expect(page.locator('[data-render-pending]')).toHaveCount(0);
  if (!fail) await expect(page.locator('[data-slot="0"] .cm-math-body svg')).not.toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  await tick(page, 3);
  await expect(page.locator('[data-render-pending]')).toHaveCount(0);
}

async function startFrames(page: Page) {
  await page.evaluate(() => {
    const probe = { running: true, frames: [] as unknown[] };
    (window as any).transitionFrames = probe;
    const frame = (time: number) => {
      const hosts = [...document.querySelectorAll<HTMLElement>('.cm-math-rendered')];
      probe.frames.push({ time, hosts: hosts.map(host => {
        const body = host.querySelector<HTMLElement>('.cm-math-body')!, box = body.getBoundingClientRect();
        const content = host.closest('.cm-content')!.getBoundingClientRect();
        return { slot: host.closest('[data-slot]')!.getAttribute('data-slot'), preview: host.classList.contains('cm-math-edit-preview'),
          bareTex: [...body.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join(''),
          svg: body.querySelectorAll('svg').length, pending: host.hasAttribute('data-render-pending'),
          status: body.querySelector('.cm-math-status')?.textContent, error: host.classList.contains('mod-error'),
          left: box.left, right: box.right, width: box.width, columnRight: content.right };
      }), highlighted: document.querySelectorAll('[data-slot="0"] [class*="cm-tex-"]').length,
      selection: window.getSelection()?.toString() });
      if (probe.running) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

async function frames(page: Page) {
  return page.evaluate(() => {
    const probe = (window as any).transitionFrames;
    probe.running = false;
    return probe.frames as { time: number; hosts: { slot: string; preview: boolean; bareTex: string; svg: number; pending: boolean; status?: string; error: boolean; right: number; columnRight: number; width: number }[]; highlighted: number; selection: string }[];
  });
}

async function tick(page: Page, count = 6) {
  await page.evaluate(count => new Promise<void>(resolve => {
    const frame = () => { if (--count) requestAnimationFrame(frame); else resolve(); };
    requestAnimationFrame(frame);
  }), count);
}

async function release(page: Page) {
  await page.evaluate(() => { const gate = (window as any).transitionGate; gate.blocked = false; gate.release(); });
  await expect(page.locator('[data-render-pending]')).toHaveCount(0);
}

function noBareTex(samples: Awaited<ReturnType<typeof frames>>) {
  expect(samples.length).toBeGreaterThan(2);
  expect(samples.flatMap(frame => frame.hosts).filter(host => /\\(?:frac|int|mathrm|text)/.test(host.bareTex)), 'No widget text node may paint unhighlighted source').toEqual([]);
}

test('display click never paints bare TeX in its async edit preview', async ({ page }, info) => {
  await open(page);
  const original = await page.locator('[data-slot="0"] .cm-math-body > mjx-container').elementHandle();
  await page.evaluate(() => { (window as any).transitionGate.blocked = true; });
  await startFrames(page);
  await page.locator('[data-slot="0"] .math-block .cm-math-body').click();
  await expect(page.locator('[data-slot="0"] .cm-math-edit-preview')).toHaveCount(1);
  await tick(page);
  await page.screenshot({ path: info.outputPath('click-pending.png'), fullPage: true });
  const samples = await frames(page);
  await writeFile(info.outputPath('click-frames.json'), JSON.stringify(samples, null, 2));
  await info.attach('click-frames', { body: JSON.stringify(samples, null, 2), contentType: 'application/json' });
  expect(await original!.evaluate(node => node === document.querySelector('[data-slot="0"] .cm-math-edit-preview .cm-math-body > mjx-container'))).toBe(true);
  await release(page);
  expect(samples.some(frame => frame.highlighted > 0)).toBe(true);
  noBareTex(samples);
  expect(samples.filter(frame => frame.hosts.some(host => host.preview && host.pending)).every(frame => frame.hosts.filter(host => host.preview).every(host => host.svg === 1))).toBe(true);
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
});

for (const context of ['display', 'inline', 'callout', 'callout multiline']) {
  test(`native click enter/exit has no bare frames: ${context}`, async ({ page }, info) => {
    const raw = context === 'inline' ? `Prefix $${longTex}$ suffix\n\nTail`
      : context === 'callout' ? `> [!info]+ Transition\n> $$${longTex}$$\n\nTail`
      : context === 'callout multiline' ? `> [!info]+ Transition\n> $$\n> ${longTex}\n> $$\n\nTail` : source;
    await open(page, raw);
    await startFrames(page);
    for (let cycle = 0; cycle < 4; cycle++) {
      const original = await page.locator('[data-slot="0"] .cm-math-body > mjx-container').elementHandle();
      if (context !== 'inline' && cycle === 0) await page.evaluate(() => { (window as any).transitionGate.blocked = true; });
      await page.locator('[data-slot="0"] .cm-math-body').click({ position: { x: 15, y: 12 } });
      await expect(page.locator('[data-slot="0"] .cm-tex-command').first()).toBeVisible();
      if (context === 'inline') await expect(page.locator('.cm-tooltip-cursor svg')).not.toHaveCount(0);
      else await expect(page.locator('[data-slot="0"] .cm-math-edit-preview svg')).toHaveCount(1);
      if (context !== 'inline' && cycle === 0) {
        expect(await original!.evaluate(node => node.isConnected), 'The rendered SVG survives entry into a delayed preview').toBe(true);
        await release(page);
      }
      await tick(page, 3);
      await page.locator('[data-slot="0"] .cm-line').filter({ hasText: /^Tail$/ }).click();
      await expect(page.locator('[data-slot="0"] [class*="cm-tex-"]')).toHaveCount(0);
      await expect(page.locator('[data-render-pending]')).toHaveCount(0);
      await tick(page, 3);
    }
    await page.locator('[data-slot="1"] .cm-math-body').click({ position: { x: 15, y: 12 } });
    await expect(page.locator('[data-slot="1"] [class*="cm-tex-"]')).toHaveCount(0);
    const samples = await frames(page); noBareTex(samples);
    await writeFile(info.outputPath('native-click-frames.json'), JSON.stringify(samples, null, 2));
    expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(raw);
    expect(await page.evaluate(() => window.renderHarness.writes)).toEqual([]);
  });
}

test('cold delayed startup shows a compact status in both modes', async ({ page }, info) => {
  let unblock: () => void = () => {};
  const gate = new Promise<void>(resolve => { unblock = resolve; });
  await page.route('**/mathjax-4.1.3/startup.js', async route => { await gate; await route.continue(); });
  await page.goto('/__render-test');
  await page.waitForFunction(() => Boolean(window.renderHarness));
  await startFrames(page);
  const raw = `Inline $${longTex}$\n\n$$${longTex}$$\n\n> [!info]+ Cold\n> $$${longTex}$$\n\nTail`;
  await page.evaluate(raw => window.renderHarness.reset(raw), raw);
  await expect(page.locator('.cm-math-rendered[data-render-pending]')).toHaveCount(6);
  await tick(page);
  await page.screenshot({ path: info.outputPath('cold-pending.png'), fullPage: true });
  const samples = await frames(page); noBareTex(samples);
  const pending = samples.flatMap(frame => frame.hosts).filter(host => host.pending);
  expect(pending.length).toBeGreaterThan(6);
  expect(pending.every(host => host.svg === 0 && ['正在渲染公式…', '…'].includes(host.status ?? ''))).toBe(true);
  expect(pending.every(host => host.width < 700 && host.right <= host.columnRight + 1)).toBe(true);
  await writeFile(info.outputPath('cold-frames.json'), JSON.stringify(samples, null, 2));
  unblock();
  await expect(page.locator('[data-render-pending]')).toHaveCount(0);
  await expect(page.locator('.cm-math-body > mjx-container')).toHaveCount(6);
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(raw);
});

test('short inline cold status does not displace following text by a full message', async ({ page }, info) => {
  let unblock: () => void = () => {};
  const gate = new Promise<void>(resolve => { unblock = resolve; });
  await page.route('**/mathjax-4.1.3/startup.js', async route => { await gate; await route.continue(); });
  await page.goto('/__render-test');
  await page.waitForFunction(() => Boolean(window.renderHarness));
  const raw = 'Before $x$ after\n\nTail';
  await page.evaluate(raw => window.renderHarness.reset(raw), raw);
  await expect(page.locator('.cm-math-status')).toHaveCount(2);
  const sample = () => page.locator('[data-slot="1"] .cm-math-body').evaluate(body => {
    const rect = body.getBoundingClientRect();
    return { width: rect.width, right: rect.right, height: rect.height, text: body.textContent };
  });
  await tick(page);
  const pending = await sample();
  await page.screenshot({ path: info.outputPath('short-inline-cold.png'), fullPage: true });
  unblock();
  await expect(page.locator('[data-render-pending]')).toHaveCount(0);
  await tick(page);
  const rendered = await sample();
  await writeFile(info.outputPath('short-inline-cold-geometry.json'), JSON.stringify({ pending, rendered }, null, 2));
  expect(Math.abs(pending.width - rendered.width)).toBeLessThan(16);
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(raw);
});

test('configuration invalidation keeps successful SVG until atomic replacement', async ({ page }, info) => {
  await open(page);
  await page.evaluate(async () => {
    const { prepareMathProfile } = await import('/src/lib/mathPreamble.ts');
    const { validateMathProfile } = await import('/src/lib/mathjax.ts');
    (window as any).transitionCandidate = await validateMathProfile(await prepareMathProfile({ preamble: '\\newcommand{\\transitionmacro}{z}' }));
  });
  const originals = await page.locator('.cm-math-body > mjx-container').elementHandles();
  await startFrames(page);
  await page.evaluate(() => { (window as any).transitionGate.blocked = true; (window as any).transitionCandidate.commit(); });
  await expect.poll(() => page.evaluate(() => (window as any).transitionGate.entered)).toBeGreaterThan(0);
  await tick(page);
  for (let index = 0; index < originals.length; index++) {
    expect(await originals[index].evaluate((node, index) => node === document.querySelectorAll('.cm-math-body > mjx-container')[index], index)).toBe(true);
  }
  await release(page);
  await tick(page);
  const samples = await frames(page); noBareTex(samples);
  expect(samples.flatMap(frame => frame.hosts).every(host => host.svg === 1)).toBe(true);
  expect(await originals[0].evaluate(node => node.isConnected)).toBe(false);
  await expect(page.locator('[data-math-profile-revision="1"]')).toHaveCount(2);
  await writeFile(info.outputPath('configuration-frames.json'), JSON.stringify(samples, null, 2));
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
});

test('cold conversion failure is visible and retryable without exposing source', async ({ page }, info) => {
  await open(page, source, true);
  await expect(page.locator('.cm-math-rendered.mod-error [role="alert"]')).toHaveCount(2);
  await expect(page.locator('.cm-math-body svg')).toHaveCount(0);
  await expect(page.locator('.cm-math-rendered').first()).toHaveAttribute('title', /controlled-transition-failure/);
  await page.screenshot({ path: info.outputPath('cold-failure.png'), fullPage: true });
  await startFrames(page);
  await page.evaluate(() => { (window as any).transitionGate.fail = false; });
  for (const slot of [1, 0]) await page.locator(`[data-slot="${slot}"] .cm-math-status button`).click();
  await expect(page.locator('.cm-math-body > mjx-container')).toHaveCount(2);
  await expect(page.locator('.cm-math-rendered.mod-error')).toHaveCount(0);
  await expect(page.locator('.cm-math-rendered[title]')).toHaveCount(0);
  await tick(page);
  const samples = await frames(page); noBareTex(samples);
  await writeFile(info.outputPath('failure-retry-frames.json'), JSON.stringify(samples, null, 2));
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
});

test('failed recomputation retains SVG and recovers through retry', async ({ page }, info) => {
  await open(page);
  const original = await page.locator('[data-slot="1"] .cm-math-body > mjx-container').elementHandle();
  await startFrames(page);
  await page.evaluate(() => {
    (window as any).transitionGate.fail = true;
    document.querySelectorAll<HTMLElement>('[data-slot]').forEach(host => { host.style.width = '640px'; });
    window.dispatchEvent(new Event('resize'));
  });
  await expect(page.locator('.cm-math-rendered.mod-error')).toHaveCount(2);
  expect(await original!.evaluate(node => node === document.querySelector('[data-slot="1"] .cm-math-body > mjx-container'))).toBe(true);
  await page.screenshot({ path: info.outputPath('retained-failure.png'), fullPage: true });
  await page.evaluate(() => { (window as any).transitionGate.fail = false; });
  for (const slot of [1, 0]) await page.locator(`[data-slot="${slot}"] .cm-math-status button`).click();
  await expect(page.locator('.cm-math-rendered.mod-error')).toHaveCount(0);
  await tick(page);
  const samples = await frames(page); noBareTex(samples);
  expect(samples.flatMap(frame => frame.hosts).every(host => host.svg === 1)).toBe(true);
  await writeFile(info.outputPath('retained-failure-frames.json'), JSON.stringify(samples, null, 2));
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(source);
});

test('cancelled preview cannot write to destroyed or reused DOM', async ({ page }, info) => {
  await open(page);
  await page.evaluate(() => { (window as any).transitionGate.blocked = true; });
  await startFrames(page);
  await page.locator('[data-slot="0"] .cm-source-toggle').click();
  await expect.poll(() => page.evaluate(() => (window as any).transitionGate.entered)).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-slot="0"] .cm-math-edit-preview')).toHaveCount(0);
  const restored = await page.locator('[data-slot="0"] .cm-math-body > mjx-container').elementHandle();
  await release(page);
  expect(await restored!.evaluate(node => node.getAttribute('aria-label'))).toBe(longTex);
  await page.evaluate(() => { (window as any).transitionGate.blocked = true; });
  await page.locator('[data-slot="0"] .cm-source-toggle').click();
  await expect.poll(() => page.evaluate(() => (window as any).transitionGate.entered)).toBeGreaterThan(1);
  const detached = await page.locator('[data-slot="0"] .cm-math-edit-preview').elementHandle();
  const oldMarkup = await detached!.evaluate(node => node.innerHTML);
  await page.evaluate(() => window.renderHarness.reset('Replacement\n\n$$q=7$$\n\nTail'));
  await release(page);
  expect(await detached!.evaluate(node => node.isConnected)).toBe(false);
  expect(await detached!.evaluate(node => node.innerHTML)).toBe(oldMarkup);
  await tick(page);
  const samples = await frames(page); noBareTex(samples);
  await writeFile(info.outputPath('cancel-frames.json'), JSON.stringify(samples, null, 2));
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe('Replacement\n\n$$q=7$$\n\nTail');
});

test('font size, family and width update while successful SVG stays visible', async ({ page }, info) => {
  const raw = 'Body\n\nInline $\\text{中文 Text123}+x_i$\n\n$$\\text{中文 Text123}+x_i$$\n\nTail';
  await open(page, raw);
  const before = await page.locator('[data-slot="1"] .cm-math-body svg').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().width));
  const originals = await page.locator('.cm-math-body > mjx-container').elementHandles();
  await startFrames(page);
  await page.evaluate(() => { (window as any).transitionGate.blocked = true; });
  await page.addStyleTag({ content: '.theme-light{--font-text-size:24px;--font-text:"Noto Serif SC",serif}[data-slot]{width:600px!important}' });
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await expect.poll(() => page.evaluate(() => (window as any).transitionGate.entered)).toBeGreaterThan(0);
  await tick(page);
  expect(await originals[0].evaluate(node => node.isConnected)).toBe(true);
  await release(page);
  await page.evaluate(() => document.fonts.ready);
  await tick(page);
  const after = await page.locator('[data-slot="1"] .cm-math-body svg').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().width));
  expect(after.every((width, index) => Math.abs(width - before[index]) > 1)).toBe(true);
  const samples = await frames(page); noBareTex(samples);
  await writeFile(info.outputPath('font-width-frames.json'), JSON.stringify({ before, after, samples }, null, 2));
  expect(samples.flatMap(frame => frame.hosts).every(host => host.svg > 0)).toBe(true);
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(raw);
});

test('highlighted native source edits and Undo preserve BOM and CRLF in both modes', async ({ page }, info) => {
  const raw = '\uFEFF# Chapter\r\n\r\n$$\\frac{x}{y}+1$$ ^eq-edit\r\n\r\nTail';
  await open(page, raw);
  await startFrames(page);
  await page.locator('[data-slot="0"] .cm-source-toggle').click();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('\\frac{x}{y}+1');
  await expect(page.locator('[data-slot="0"] .cm-tex-command')).toContainText('\\frac');
  await page.keyboard.insertText('\\frac{a}{b}+2');
  await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe(raw.replace('\\frac{x}{y}+1', '\\frac{a}{b}+2'));
  await expect(page.locator('[data-slot="0"] .cm-math-edit-preview svg')).toHaveCount(1);
  await page.keyboard.press('Control+z');
  await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe(raw);
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.renderHarness.mode(0, 'source'));
  await expect(page.locator('[data-slot="0"] .cm-math-rendered:not(.cm-math-edit-preview)')).toHaveCount(0);
  await expect(page.locator('[data-slot="0"] .cm-tex-command')).toContainText('\\frac');
  await page.evaluate(() => window.renderHarness.mode(0, 'reading'));
  await expect(page.locator('[data-slot="0"] .cm-math-body svg')).toHaveCount(1);
  await expect(page.locator('[data-slot="0"] .cm-source-toggle')).toHaveCount(0);
  await expect(page.locator('[data-slot="1"] .cm-math-body svg')).toHaveCount(1);
  await expect(page.locator('[data-render-pending]')).toHaveCount(0);
  await tick(page);
  const samples = await frames(page); noBareTex(samples);
  await writeFile(info.outputPath('source-undo-frames.json'), JSON.stringify(samples, null, 2));
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(raw);
  expect(await page.evaluate(() => window.renderHarness.writes)).toEqual([]);
});

test('same-position replacement aborts obsolete renders and updates ranges, anchors and source controls', async ({ page }, info) => {
  const raw = 'Padding12345\n\n$$x+1$$ ^eq-first\n\nTail';
  await open(page, raw);
  await startFrames(page);
  const initial = await page.locator('[data-slot="1"] .cm-math-body > mjx-container').elementHandle();
  await page.evaluate(() => {
    (window as any).transitionGate.blocked = true;
    const raw = window.renderHarness.source(0), from = raw.indexOf('$$'), to = raw.indexOf('\n\nTail');
    window.renderHarness.edit(0, [{ from, to, insert: '$$y+2+333$$ ^eq-second' }]);
  });
  await expect.poll(() => page.evaluate(() => (window as any).transitionGate.entered)).toBe(1);
  await expect(page.locator('[data-slot="1"] [data-equation-id="eq-second"]')).toHaveCount(1);
  await page.evaluate(() => {
    const raw = window.renderHarness.source(0), from = raw.indexOf('$$'), to = raw.indexOf('\n\nTail');
    window.renderHarness.edit(0, [{ from, to, insert: '$$z+3+4444$$ ^eq-third' }]);
  });
  await page.evaluate(() => (window as any).transitionGate.release());
  await expect.poll(() => page.evaluate(() => (window as any).transitionGate.entered)).toBe(2);
  await tick(page);
  await expect(page.locator('.cm-math-rendered[data-render-pending][aria-busy="true"]')).toHaveCount(2);
  expect(await initial!.evaluate(node => node.getAttribute('aria-label'))).toBe('x+1');
  expect(await initial!.evaluate(node => node.isConnected)).toBe(true);
  await release(page);
  await expect(page.locator('.cm-math-body > mjx-container[aria-label="z+3+4444"]')).toHaveCount(2);
  await expect(page.locator('[data-equation-id="eq-first"],[data-equation-id="eq-second"]')).toHaveCount(0);
  await page.locator('[data-slot="0"] .cm-source-toggle').click();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('z+3+4444');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.renderHarness.cursor(0, window.renderHarness.source(0).length));
  await expect(page.locator('[data-render-pending]')).toHaveCount(0);
  const numbered = await page.locator('[data-slot="1"] [data-equation-id="eq-third"] .cm-math-body > mjx-container').elementHandle();
  const beforeCount = await page.evaluate(() => (window as any).transitionGate.conversions);
  await page.evaluate(() => window.renderHarness.edit(0, [{ from: 0, to: 'Padding12345'.length, insert: '$$w=0$$     ' }]));
  await expect(page.locator('[data-slot="1"] [data-equation-id="eq-third"] .cm-equation-number')).toHaveText('(1-2)');
  await expect(page.locator('[data-render-pending]')).toHaveCount(0);
  expect(await numbered!.evaluate(node => node.isConnected)).toBe(true);
  expect(await page.evaluate(() => (window as any).transitionGate.conversions) - beforeCount).toBe(1);
  await page.evaluate(() => window.renderHarness.edit(0, [{ from: 0, to: 0, insert: 'Moved\n\n' }]));
  await expect(page.locator('[data-render-pending]')).toHaveCount(0);
  await page.locator('[data-slot="0"] [data-equation-id="eq-third"] .cm-source-toggle').click();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('z+3+4444');
  await page.keyboard.press('Escape');
  await tick(page);
  const samples = await frames(page); noBareTex(samples);
  await writeFile(info.outputPath('replacement-race-frames.json'), JSON.stringify(samples, null, 2));
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe('Moved\n\n$$w=0$$     \n\n$$z+3+4444$$ ^eq-third\n\nTail');
});

test('changing only a shared prefix keeps equal content and matches fresh geometry', async ({ page }, info) => {
  const raw = '> $$\n> x+1\n> $$\n\nTail';
  await open(page, raw);
  const original = await page.locator('[data-slot="1"] .cm-math-rendered').elementHandle();
  const geometry = () => page.locator('[data-slot="1"] .cm-prefixed-block').evaluate(shell => {
    const box = shell.getBoundingClientRect(), prefix = shell.firstElementChild!.getBoundingClientRect();
    const body = shell.lastElementChild!.getBoundingClientRect();
    return { prefix: shell.firstElementChild!.textContent, advance: body.left - box.left, width: prefix.width,
      left: body.left, right: body.right, height: body.height };
  });
  const before = await geometry();
  await page.evaluate(async () => {
    const { EditorView } = await import('/node_modules/.vite/deps/@codemirror_view.js');
    const { mathBlockField } = await import('/src/lib/livePreview.ts');
    const view = EditorView.findFromDOM(document.querySelector('[data-slot="1"] .cm-content')!)!;
    (window as any).transitionPrefixWidget = view.state.field(mathBlockField).iter().value.spec.widget;
  });
  await startFrames(page);
  await page.evaluate(() => {
    window.renderHarness.edit(0, [{ from: 1, to: 2, insert: '\t' }]);
  });
  await expect(page.locator('[data-render-pending]')).toHaveCount(0);
  await tick(page);
  const updated = await geometry();
  const equality = await page.evaluate(async () => {
    const { EditorView } = await import('/node_modules/.vite/deps/@codemirror_view.js');
    const { mathBlockField } = await import('/src/lib/livePreview.ts');
    const view = EditorView.findFromDOM(document.querySelector('[data-slot="1"] .cm-content')!)!;
    const current = view.state.field(mathBlockField).iter().value.spec.widget, previous = (window as any).transitionPrefixWidget;
    return { equal: current.content.eq(previous.content), before: { tex: previous.content.tex, range: previous.content.range }, after: { tex: current.content.tex, range: current.content.range } };
  });
  await writeFile(info.outputPath('prefix-equality-state.json'), JSON.stringify({ before, updated, equality, retained: await original!.evaluate(node => node.isConnected) }, null, 2));
  expect(equality.equal).toBe(true);
  expect(await original!.evaluate(node => node.isConnected)).toBe(true);
  expect(updated.prefix).toBe('>\t');
  expect(updated.advance).toBeCloseTo(updated.width, 3);
  expect(Math.abs(updated.advance - before.advance)).toBeGreaterThan(0.1);
  const edited = raw.replace('> ', '>\t');
  await page.evaluate(raw => window.renderHarness.reset(raw), edited);
  await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe(edited);
  await expect(page.locator('[data-slot="1"] .cm-math-body > mjx-container')).toHaveCount(1);
  await expect(page.locator('[data-render-pending]')).toHaveCount(0);
  await tick(page);
  const fresh = await geometry();
  expect(updated).toEqual(fresh);
  const samples = await frames(page); noBareTex(samples);
  await writeFile(info.outputPath('prefix-equality-geometry.json'), JSON.stringify({ before, updated, fresh, samples }, null, 2));
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(edited);
});
