import { test, expect } from './test';
import type { Page, TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

interface SurfaceFrame { time: number; hosts: { kind: string; text: string; labels: (string | null)[]; busy: boolean; width: number; height: number; left: number; outputWidth: number }[] }

async function evidence(info: TestInfo, name: string, value: unknown) {
  const path = info.outputPath(`${name}.json`);
  await writeFile(path, JSON.stringify(value, null, 2));
  await info.attach(name, { path, contentType: 'application/json' });
}

async function open(page: Page) {
  await page.goto('/__render-test');
  await page.waitForFunction(() => Boolean(window.renderHarness));
  await page.evaluate(async () => {
    const { loadMathJax } = await import('/src/lib/mathjax.ts');
    const runtime = await loadMathJax(), factory = runtime.startup.mathjax.document;
    const gate = { blocked: false, fail: false, entered: 0, releases: [] as (() => void)[], unhandled: [] as string[] };
    (window as any).surfaceGate = gate;
    window.addEventListener('unhandledrejection', event => { gate.unhandled.push(String(event.reason)); event.preventDefault(); });
    runtime.startup.mathjax.document = function (...args: Parameters<typeof factory>) {
      const engine = factory.apply(this, args), convert = engine.convertPromise;
      engine.convertPromise = async function (tex, options) {
        if (tex !== '\\begingroupSandbox') {
          if (gate.blocked) await new Promise<void>(resolve => { gate.entered++; gate.releases.push(resolve); });
          if (gate.fail) throw new Error('controlled-surface-failure');
        }
        return convert.call(this, tex, options);
      };
      return engine;
    };
  });
}

async function tick(page: Page, count = 5) {
  await page.evaluate(count => new Promise<void>(resolve => {
    const frame = () => { if (--count) requestAnimationFrame(frame); else resolve(); };
    requestAnimationFrame(frame);
  }), count);
}

async function startFrames(page: Page) {
  await page.evaluate(() => {
    const probe = { running: true, frames: [] as SurfaceFrame[] };
    (window as any).surfaceFrames = probe;
    const frame = (time: number) => {
      probe.frames.push({ time, hosts: [...document.querySelectorAll('.cm-math-tooltip-body, .suggestion-equation-preview, #surface-plugin')].map(host => ({
        kind: host.className, text: host.textContent ?? '', busy: host.getAttribute('aria-busy') === 'true',
        width: host.getBoundingClientRect().width, height: host.getBoundingClientRect().height, left: host.getBoundingClientRect().left,
        outputWidth: host.querySelector('mjx-container')?.getBoundingClientRect().width ?? 0,
        labels: [...host.querySelectorAll(':scope > mjx-container')].map(output => output.getAttribute('aria-label')),
      })) });
      if (probe.running) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

async function frames(page: Page) {
  return page.evaluate(() => {
    const probe = (window as any).surfaceFrames; probe.running = false;
    return probe.frames as SurfaceFrame[];
  });
}

async function release(page: Page, fail = false) {
  await page.evaluate(fail => {
    const gate = (window as any).surfaceGate;
    gate.fail = fail; gate.blocked = false; gate.releases.splice(0).forEach((resolve: () => void) => resolve());
  }, fail);
  await tick(page);
}

async function tooltip(page: Page) {
  await page.evaluate(async () => {
    const { EditorView } = await import('/node_modules/.vite/deps/@codemirror_view.js');
    const { createMathTooltip } = await import('/src/lib/mathTooltip.ts');
    const view = EditorView.findFromDOM(document.querySelector('[data-slot="0"] .cm-editor')!);
    const tooltip = createMathTooltip(view, 'x+17', { display: false, sourcePath: 'a.md', definitions: [] });
    view.dom.appendChild(tooltip.dom); tooltip.mount!(view);
    (window as any).surfaceTooltip = { tooltip, view };
  });
}

async function remeasure(page: Page) {
  await page.evaluate(() => {
    const { tooltip, view } = (window as any).surfaceTooltip;
    view.dom.closest('[data-slot]').style.width = `${view.dom.clientWidth - 31}px`;
    tooltip.update({ geometryChanged: true });
  });
}

async function suggestions(page: Page) {
  const raw = '$$a+11$$\n\n$$b+22$$\n\n[[#^eq';
  await page.evaluate(raw => window.renderHarness.reset(raw), raw);
  await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe(raw);
  await page.evaluate(() => { window.renderHarness.cursor(0, window.renderHarness.source(0).length); window.renderHarness.focus(0); });
  await expect(page.locator('.suggestion-equation-preview svg')).toHaveCount(1);
}

test('tooltip retains successful SVG on delayed recompute failure and recovers', async ({ page }, info) => {
  await open(page); await tooltip(page);
  const body = page.locator('.cm-math-tooltip-body');
  await expect(body.locator(':scope > mjx-container')).toHaveCount(1);
  const original = await body.locator('mjx-container').elementHandle();
  await startFrames(page);
  await page.evaluate(() => { (window as any).surfaceGate.blocked = true; });
  await remeasure(page);
  await expect.poll(() => page.evaluate(() => (window as any).surfaceGate.entered)).toBeGreaterThan(0);
  await tick(page);
  const pending = { svg: await body.locator(':scope > mjx-container').count(), text: await body.textContent(), busy: await body.getAttribute('aria-busy') };
  await page.screenshot({ path: info.outputPath('tooltip-pending.png') });
  await release(page, true);
  const failed = { svg: await body.locator(':scope > mjx-container').count(), text: await body.textContent(), same: await original!.evaluate(node => node.isConnected) };
  await evidence(info, 'tooltip-states', { pending, failed });
  expect(failed.svg).toBe(1); expect(failed.same).toBe(true);
  expect(failed.text).toContain('无法渲染公式');
  expect(pending.busy).toBe('true');
  await page.evaluate(() => { (window as any).surfaceGate.fail = false; });
  await remeasure(page);
  await expect(body.locator(':scope > mjx-container')).toHaveCount(1);
  await expect(body).not.toContainText('无法渲染公式');
  await expect(body).not.toHaveAttribute('aria-busy');
  const samples = await frames(page);
  expect(samples.length).toBeGreaterThan(5);
  expect(samples.flatMap(frame => frame.hosts).every(host => host.labels.length === 1)).toBe(true);
  expect(samples.some(frame => frame.hosts.some(host => host.busy))).toBe(true);
  expect(new Set(samples.flatMap(frame => frame.hosts).map(host => host.outputWidth)).size).toBe(1);
  await evidence(info, 'tooltip-frames', samples);
});

test('new suggestion has explicit pending, never old SVG, and visible failure', async ({ page }, info) => {
  await open(page); await suggestions(page);
  const preview = page.locator('.suggestion-equation-preview');
  const oldTex = await preview.locator('mjx-container').getAttribute('aria-label');
  await startFrames(page);
  await page.evaluate(() => { (window as any).surfaceGate.blocked = true; });
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => page.evaluate(() => (window as any).surfaceGate.entered)).toBeGreaterThan(0);
  await tick(page);
  const pending = { svg: await preview.locator('svg').count(), text: await preview.textContent(), busy: await preview.getAttribute('aria-busy'), oldTex };
  await page.screenshot({ path: info.outputPath('suggestion-pending.png') });
  await release(page, true);
  await evidence(info, 'suggestion-states', { pending, failure: await preview.textContent() });
  await expect(preview).toContainText('无法渲染公式');
  expect(pending.svg).toBe(0); expect(pending.busy).toBe('true'); expect(pending.text).toContain('正在渲染');
  await page.evaluate(() => { (window as any).surfaceGate.fail = false; });
  await page.keyboard.press('ArrowUp');
  await expect(preview.locator('svg')).toHaveCount(1);
  await expect(preview).not.toContainText('无法渲染公式');
  const samples = await frames(page);
  expect(samples.length).toBeGreaterThan(5);
  const pendingHosts = samples.flatMap(frame => frame.hosts).filter(host => host.busy);
  expect(pendingHosts.length).toBeGreaterThan(3);
  expect(pendingHosts.every(host => host.labels.length === 0 && host.text.includes('正在渲染'))).toBe(true);
  await evidence(info, 'suggestion-frames', samples);
});

for (const fail of [false, true]) test(`closing suggestions aborts delayed ${fail ? 'failure' : 'success'} without changing detached output`, async ({ page }) => {
  await open(page); await suggestions(page);
  await page.evaluate(() => { (window as any).surfaceGate.blocked = true; });
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => page.evaluate(() => (window as any).surfaceGate.entered)).toBeGreaterThan(0);
  const removed = await page.locator('.suggestion-equation-preview').elementHandle();
  await page.keyboard.press('Escape');
  await expect(page.locator('.suggestion-container')).toHaveCount(0);
  const before = await removed!.evaluate(node => node.outerHTML);
  await release(page, fail);
  expect(await removed!.evaluate(node => node.outerHTML)).toBe(before);
  expect(await page.evaluate(() => (window as any).surfaceGate.unhandled)).toEqual([]);
});

test('same suggestion recompute retains its successful SVG with pending and error state', async ({ page }) => {
  await open(page);
  const raw = '$$a+11$$\n\n[[#^eq';
  await page.evaluate(raw => window.renderHarness.reset(raw), raw);
  await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe(raw);
  await page.evaluate(() => { window.renderHarness.cursor(0, window.renderHarness.source(0).length); window.renderHarness.focus(0); });
  const preview = page.locator('.suggestion-equation-preview');
  await expect(preview.locator('mjx-container')).toHaveCount(1);
  const original = await preview.locator('mjx-container').elementHandle();
  await page.evaluate(() => { (window as any).surfaceGate.blocked = true; });
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => page.evaluate(() => (window as any).surfaceGate.entered)).toBeGreaterThan(0);
  const pendingSame = await original!.evaluate(node => node.isConnected);
  await release(page, true);
  expect(pendingSame).toBe(true);
  expect(await original!.evaluate(node => node.isConnected)).toBe(true);
  await expect(preview).toContainText('无法渲染公式');
  await page.evaluate(() => { (window as any).surfaceGate.fail = false; });
  await page.keyboard.press('ArrowDown');
  await expect(preview.locator('mjx-container')).toHaveCount(1);
  await expect(preview).not.toContainText('无法渲染公式');
});

for (const fail of [false, true]) test(`tooltip destruction cancels delayed ${fail ? 'failure' : 'success'} presentation`, async ({ page }) => {
  await open(page);
  await page.evaluate(() => { (window as any).surfaceGate.blocked = true; });
  await tooltip(page);
  await expect.poll(() => page.evaluate(() => (window as any).surfaceGate.entered)).toBeGreaterThan(0);
  const removed = await page.locator('.cm-math-tooltip-body').elementHandle();
  await page.evaluate(() => { const { tooltip } = (window as any).surfaceTooltip; tooltip.destroy(); tooltip.dom.remove(); });
  const before = await removed!.evaluate(node => node.outerHTML);
  await release(page, fail);
  expect(await removed!.evaluate(node => node.outerHTML)).toBe(before);
  expect(await page.evaluate(() => (window as any).surfaceGate.unhandled)).toEqual([]);
});

test('cold tooltip keeps explicit pending and visible error without an old formula', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { (window as any).surfaceGate.blocked = true; });
  await tooltip(page);
  const body = page.locator('.cm-math-tooltip-body');
  await expect.poll(() => page.evaluate(() => (window as any).surfaceGate.entered)).toBeGreaterThan(0);
  await expect(body).toContainText('正在渲染公式…');
  await expect(body).toHaveAttribute('aria-busy', 'true');
  await expect(body.locator('mjx-container')).toHaveCount(0);
  await release(page, true);
  await expect(body).toContainText('无法渲染公式');
  await expect(body).not.toHaveAttribute('aria-busy');
});

test('plugin renderMath rejects finishRenderMath without an orphan rejection', async ({ page }, info) => {
  await open(page);
  await page.evaluate(async () => {
    const { obsidianModule } = await import('/src/lib/obsidian/runtime.ts');
    (window as any).surfaceGate.blocked = true;
    const host = obsidianModule.renderMath('z+39', false);
    host.id = 'surface-plugin'; document.body.appendChild(host);
    (window as any).surfaceFinish = obsidianModule.finishRenderMath().then(() => 'resolved', (error: Error) => error.message);
  });
  await expect.poll(() => page.evaluate(() => (window as any).surfaceGate.entered)).toBeGreaterThan(0);
  const pending = await page.locator('#surface-plugin').textContent();
  await tick(page); await release(page, true);
  expect(await page.evaluate(() => (window as any).surfaceFinish)).toContain('controlled-surface-failure');
  await tick(page);
  const unhandled = await page.evaluate(() => (window as any).surfaceGate.unhandled);
  await evidence(info, 'plugin-rejections', { pending, unhandled });
  expect(unhandled).toEqual([]);
  await expect(page.locator('#surface-plugin')).toContainText('无法渲染公式');
  expect(pending).toContain('正在渲染');
  expect(await page.evaluate(async () => { const { obsidianModule } = await import('/src/lib/obsidian/runtime.ts'); await obsidianModule.finishRenderMath(); return true; })).toBe(true);
  await page.evaluate(async () => {
    const { obsidianModule } = await import('/src/lib/obsidian/runtime.ts');
    (window as any).surfaceGate.fail = false;
    const host = obsidianModule.renderMath('z+40', false); host.id = 'surface-plugin-recovery'; document.body.append(host);
    await obsidianModule.finishRenderMath();
  });
  await expect(page.locator('#surface-plugin-recovery > mjx-container')).toHaveCount(1);
  await expect(page.locator('#surface-plugin-recovery')).not.toHaveAttribute('aria-busy');
});

test('native inline cursor tooltip preserves output across delayed configuration failure', async ({ page }, info) => {
  await open(page);
  const raw = '# Inline preview\n\nFirst paragraph\n\nSecond paragraph\n\nBefore $x+17$ after\n\nTail';
  await page.evaluate(raw => window.renderHarness.reset(raw), raw);
  await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe(raw);
  await expect(page.locator('.cm-math-body > mjx-container')).toHaveCount(2);
  await page.evaluate(() => window.renderHarness.cursor(0, window.renderHarness.source(0).indexOf('x+17') + 2));
  const body = page.locator('.cm-math-tooltip-body');
  await expect(body.locator(':scope > mjx-container')).toHaveCount(1);
  const original = await body.locator(':scope > mjx-container').elementHandle();
  await startFrames(page); await tick(page);
  await page.evaluate(async () => {
    const { prepareMathProfile } = await import('/src/lib/mathPreamble.ts');
    const { validateMathProfile } = await import('/src/lib/mathjax.ts');
    const candidate = await validateMathProfile(await prepareMathProfile({ preamble: '\\newcommand{\\surfaceprobe}{t}' }));
    (window as any).surfaceGate.blocked = true;
    candidate.commit();
  });
  await expect.poll(() => page.evaluate(() => (window as any).surfaceGate.entered)).toBeGreaterThan(0);
  await expect(body).toHaveAttribute('aria-busy', 'true');
  await tick(page);
  await release(page, true);
  await expect(body).toContainText('无法渲染公式');
  await expect(body).toBeVisible();
  await expect(body).toBeInViewport();
  expect(await original!.evaluate(node => node.isConnected)).toBe(true);
  const samples = await frames(page);
  expect(samples.flatMap(frame => frame.hosts).every(host => host.labels.length === 1)).toBe(true);
  expect(samples.flatMap(frame => frame.hosts).filter(host => host.busy).every(host => host.width === host.outputWidth)).toBe(true);
  await evidence(info, 'native-tooltip-frames', samples);
  await page.screenshot({ path: info.outputPath('native-tooltip-retained-error.png') });
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(raw);
  expect(await page.evaluate(() => window.renderHarness.writes)).toEqual([]);
  await page.evaluate(() => window.renderHarness.cursor(0, window.renderHarness.source(0).length));
  await expect(body).toHaveCount(0);
});

test('rapid suggestion switch back cancels obsolete output before replacement', async ({ page }, info) => {
  await open(page); await suggestions(page);
  const preview = page.locator('.suggestion-equation-preview');
  const first = await preview.locator('mjx-container').getAttribute('aria-label');
  await page.evaluate(() => { (window as any).surfaceGate.blocked = true; });
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => page.evaluate(() => (window as any).surfaceGate.entered)).toBeGreaterThan(0);
  const obsolete = await preview.elementHandle();
  await page.keyboard.press('ArrowUp');
  const before = await obsolete!.evaluate(node => node.outerHTML);
  await startFrames(page); await tick(page);
  await release(page);
  await expect(preview.locator('mjx-container')).toHaveAttribute('aria-label', first!);
  expect(await obsolete!.evaluate(node => node.outerHTML)).toBe(before);
  expect(await obsolete!.evaluate(node => node.isConnected)).toBe(false);
  const samples = await frames(page);
  expect(samples.flatMap(frame => frame.hosts).every(host => host.busy ? host.labels.length === 0 : host.labels.every(label => label === first))).toBe(true);
  await evidence(info, 'switch-cancellation-frames', samples);
});
