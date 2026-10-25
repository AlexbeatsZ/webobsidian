import { test, expect } from './test';

test.describe('script Markdown fragment failure', () => {
  test.use({ expectedErrors: ['controlled-script-fragment-failure', 'The above error occurred'] });
  test('real React failure rejects the script helper and permits owned cleanup', async ({ page }) => {
    await page.goto('/__render-test');
    await page.waitForFunction(() => Boolean(window.renderHarness));
    const result = await page.evaluate(async () => {
      const { JavascriptRun } = await import('/src/lib/javascript/lifetime.ts');
      const { mountMarkdownFragment } = await import('/src/components/MarkdownFragment.tsx');
      const host = document.createElement('div'); document.body.append(host);
      const poison = Object.defineProperty({}, 'sourcePath', { enumerable: true,
        get() { throw new Error('controlled-script-fragment-failure'); } });
      const context = { sourcePath: 'script.md', mountFragment(target: HTMLElement, source: string, options: any) {
        return mountMarkdownFragment(target, source, { ...options, context: poison as any });
      } };
      const run = new JavascriptRun({} as any, host, context as any, () => {}, () => {});
      await run.load();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const failure = await Promise.race([
          run.renderMarkdown('failure').then(() => 'unexpected-ready', error => String(error.message)),
          new Promise<string>(resolve => { timeout = setTimeout(() => resolve('still-pending'), 2000); }),
        ]);
        return { failure, pending: host.hasAttribute('data-render-pending'), alert: host.querySelector('[role="alert"]')?.textContent };
      } finally { clearTimeout(timeout); run.unload(); await Promise.resolve(); }
    });
    expect(result).toEqual({ failure: 'controlled-script-fragment-failure', pending: false, alert: 'controlled-script-fragment-failure' });
  });
});
