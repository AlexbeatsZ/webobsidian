import { test, expect } from './test';
import type { Page } from '@playwright/test';

const raw = '\uFEFFKeep untouched.\r\n\r\nOriginal line.\r\n\r\nTail sentinel.\r\n';
const candidate = '**Candidate line.** $x+11$\n';

async function openReview(page: Page, delayed = false, rawSource = raw) {
  await page.goto('/__render-test');
  await page.waitForFunction(() => Boolean(window.renderHarness));
  await page.evaluate(source => window.renderHarness.reset(source), rawSource);
  await expect.poll(() => page.evaluate(() => window.renderHarness.source(0))).toBe(rawSource);
  await page.evaluate(async ({ raw, candidate, delayed }) => {
    const { EditorView } = await import('/node_modules/.vite/deps/@codemirror_view.js');
    const { StateEffect, Prec } = await import('/node_modules/.vite/deps/@codemirror_state.js');
    const { nativeReviewExtension } = await import('/src/lib/review/view.ts');
    const { reviewSnapshot } = await import('/src/lib/review/client.ts');
    const { renderContext, contextOf } = await import('/src/lib/renderContext.ts');
    const view = EditorView.findFromDOM(document.querySelector('[data-slot="0"] .cm-editor')!);
    const original = contextOf(view);
    const probe = { view, mounted: 0, disposed: 0, requests: [] as any[], contexts: [] as any[], field: undefined as any,
      widgets: () => {
        const widgets: any[] = [];
        view.state.field(probe.field).decorations.between(0, view.state.doc.length, (_from: number, _to: number, decoration: any) => {
          if (decoration.spec.widget) widgets.push(decoration.spec.widget);
        });
        return widgets;
      } };
    (window as any).reviewProbe = probe;
    const from = raw.indexOf('Original line.');
    reviewSnapshot().selected = { id: 'lifetime-review', request_id: 'fixture', title: 'Lifetime review', root: 'fixture',
      path: 'a.md', createdAt: '2026-10-25T00:00:00Z', baseline: raw, applied: [],
      hunks: [{ id: 'h1', from, to: raw.indexOf('\n', from) + 1,
        insert: delayed ? '![[delayed]]\n' : candidate, decision: 'pending' }] };
    const context = { ...original,
      renderEmbed: delayed ? (_target: string, signal: AbortSignal) => new Promise(resolve => {
        probe.requests.push({ signal, release: (text: string) => resolve({ path: 'delayed.md', context: original,
          read: () => ({ source: text, from: 0 }), subscribe: () => () => {} }) });
      }) : original.renderEmbed,
      mountFragment: (host: HTMLElement, source: string, options: any) => {
        probe.mounted++; probe.contexts.push(options.context);
        const cleanup = original.mountFragment!(host, source, options);
        return () => { probe.disposed++; cleanup(); };
      },
    };
    const extension = nativeReviewExtension('a.md') as any[];
    probe.field = extension[0];
    view.dispatch({ effects: StateEffect.appendConfig.of([Prec.highest(renderContext.of(context)), extension]) });
  }, { raw: rawSource, candidate, delayed });
  await expect(page.locator('[data-slot="0"] .native-review-bar')).toBeVisible();
  await expect(page.locator('[data-slot="0"] .native-review-candidate')).toHaveCount(1);
}

test('equal replacement widgets dispose the reused React and fragment DOM owners once', async ({ page }, info) => {
  await openReview(page, false, '> [!note] Keep untouched.\n> Intro.\n> Original line.\n');
  await expect(page.locator('[data-slot="0"] .native-review-candidate mjx-container')).toHaveCount(1);
  const result = await page.evaluate(async () => {
    const probe = (window as any).reviewProbe;
    const before = probe.widgets();
    const toolbar = document.querySelector('[data-slot="0"] .native-review-bar')!.parentElement!;
    const candidate = document.querySelector('[data-slot="0"] .native-review-candidate')!;
    probe.view.dispatch({ selection: { anchor: probe.view.state.doc.length } });
    const selectionUnchanged = before.every((widget: any, index: number) => widget === probe.widgets()[index]);
    window.renderHarness.edit(0, [{ from: 4, to: 8, insert: 'info' }]);
    const after = probe.widgets();
    const equal = before.every((widget: any, index: number) => widget !== after[index] && widget.eq(after[index]));
    const reused = toolbar === document.querySelector('[data-slot="0"] .native-review-bar')!.parentElement &&
      candidate === document.querySelector('[data-slot="0"] .native-review-candidate');
    const transferred = [(toolbar as any).cmTile?.widget === after[0], (candidate as any).cmTile?.widget === after[1]];
    probe.view.destroy();
    await new Promise(resolve => setTimeout(resolve, 30));
    const result = { selectionUnchanged, equal, reused, transferred, mounted: probe.mounted, disposed: probe.disposed,
      toolbarChildren: toolbar.childElementCount, fragmentEditors: candidate.querySelectorAll('.cm-editor').length };
    probe.view.destroy();
    await new Promise(resolve => setTimeout(resolve, 30));
    return { ...result, finalDisposed: probe.disposed };
  });
  await info.attach('equal-widget-owners', { body: JSON.stringify(result), contentType: 'application/json' });
  expect(result).toEqual({ selectionUnchanged: true, equal: true, reused: true, transferred: [true, true], mounted: 1, disposed: 1,
    toolbarChildren: 0, fragmentEditors: 0, finalDisposed: 1 });
});

test('real preview and source toggles retain raw bytes and revive the red and green hunks after undo', async ({ page }, info) => {
  await openReview(page);
  const review = page.locator('[data-slot="0"] .native-review-candidate');
  await expect(review.locator('mjx-container')).toHaveCount(1);
  await expect(page.locator('[data-slot="0"] .native-review-removed')).toContainText('Original line.');
  await review.getByRole('button', { name: '查看源码' }).click();
  await expect(review.locator('pre')).toHaveText(candidate);
  await review.getByRole('button', { name: '查看预览' }).click();
  await expect(review.locator('mjx-container')).toHaveCount(1);
  await page.evaluate(() => {
    const root = document.querySelector('[data-slot="0"] .native-review-candidate')!;
    for (let count = 0; count < 3; count++) (root.querySelector('.native-review-actions button:last-child') as HTMLButtonElement).click();
  });
  await expect(review.locator('pre')).toHaveText(candidate);
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(raw);
  await page.evaluate(() => {
    const view = (window as any).reviewProbe.view;
    window.renderHarness.edit(0, [{ from: view.state.doc.toString().indexOf('Original'), insert: 'Local ' }]);
  });
  await expect(review).toHaveCount(0);
  await page.evaluate(() => window.renderHarness.undo(0));
  await expect(review).toHaveCount(1);
  await expect(review.locator('mjx-container')).toHaveCount(1);
  await expect(page.locator('[data-slot="0"] .native-review-removed')).toContainText('Original line.');
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe(raw);
  expect(await page.evaluate(() => window.renderHarness.writes)).toEqual([]);
  const result = await page.evaluate(() => {
    const probe = (window as any).reviewProbe;
    return { mounted: probe.mounted, disposed: probe.disposed, source: window.renderHarness.source(0),
      safe: probe.contexts.every((context: any) => context.allowPlugins === false && context.allowScriptExecution === false &&
        context.allowHtmlExecution === false && context.allowBlockEffects === false && !context.bindEditor) };
  });
  await info.attach('toggle-undo-source', { body: JSON.stringify(result), contentType: 'application/json' });
  expect(result.safe).toBe(true);
  expect(result.mounted - result.disposed).toBe(1);
});

test('delayed real embed preview aborts on source switch and removal without publishing stale output', async ({ page }, info) => {
  await openReview(page, true);
  const review = page.locator('[data-slot="0"] .native-review-candidate');
  await expect.poll(() => page.evaluate(() => (window as any).reviewProbe.requests.length)).toBe(1);
  await review.getByRole('button', { name: '查看源码' }).click();
  await expect(review.locator('pre')).toHaveText('![[delayed]]\n');
  await expect.poll(() => page.evaluate(() => (window as any).reviewProbe.requests[0].signal.aborted)).toBe(true);
  await review.getByRole('button', { name: '查看预览' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).reviewProbe.requests.length)).toBe(2);
  await page.evaluate(() => {
    const probe = (window as any).reviewProbe;
    probe.requests[0].release('**STALE OUTPUT**');
    probe.requests[1].release('**Current output** $z+23$');
  });
  await expect(review).toContainText('Current output');
  await expect(review.locator('mjx-container')).toHaveCount(1);
  await expect(review).not.toContainText('STALE OUTPUT');
  await review.getByRole('button', { name: '查看源码' }).click();
  await review.getByRole('button', { name: '查看预览' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).reviewProbe.requests.length)).toBe(3);
  const result = await page.evaluate(async () => {
    const probe = (window as any).reviewProbe;
    const root = document.querySelector('[data-slot="0"] .native-review-candidate')!;
    window.renderHarness.edit(0, [{ from: probe.view.state.doc.length, insert: 'Unrelated edit.' }]);
    probe.view.destroy();
    await new Promise(resolve => setTimeout(resolve, 30));
    const abortedBeforeRelease = probe.requests[2].signal.aborted;
    probe.requests[2].release('**DETACHED OUTPUT**');
    await new Promise(resolve => setTimeout(resolve, 30));
    return { abortedBeforeRelease, mounted: probe.mounted, disposed: probe.disposed,
      detachedOutput: root.textContent!.includes('DETACHED OUTPUT'), editors: root.querySelectorAll('.cm-editor').length };
  });
  await info.attach('delayed-preview-lifetime', { body: JSON.stringify(result), contentType: 'application/json' });
  expect(result).toEqual({ abortedBeforeRelease: true, mounted: 3, disposed: 3, detachedOutput: false, editors: 0 });
});
