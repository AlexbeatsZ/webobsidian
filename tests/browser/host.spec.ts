import { test, expect } from './test';

test.beforeEach(async ({ page }) => { await page.goto('/__render-test'); });

test('native identity and actual Android version are shared with the LaTeX adapter', async ({ page }) => {
  const value = await page.evaluate(async () => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'WebObsidianAndroid/0.1.67' });
    const { Platform, appVersion } = await import('/src/lib/platform.ts');
    const runtime = await import('/src/lib/obsidian/runtime.ts');
    return { version: appVersion(), android: Platform.isAndroidApp, mobile: runtime.Platform.isMobile,
      same: runtime.Platform === Platform, linux: Platform.isLinux };
  });
  expect(value).toEqual({ version: '0.1.67', android: true, mobile: true, same: true, linux: false });
});

test('host exports and clipboard share the transferred Android port including cancellation', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { host } = await import('/src/lib/host.ts');
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'WebObsidianAndroid/0.1.67' });
    const channel = new MessageChannel();
    const actions: string[] = [];
    channel.port1.onmessage = event => {
      const message = JSON.parse(event.data);
      actions.push(message.action);
      const value = message.action === 'clipboard-read' ? '中文 😃' : message.input.filename === 'cancel.json' ? false : atob(message.input.base64) === 'fixture';
      channel.port1.postMessage(JSON.stringify({ id: message.id, value }));
    };
    window.postMessage('webobsidian-host', '*', [channel.port2]);
    const text = await host.readClipboardText();
    const saved = await host.download(new Blob(['fixture'], { type: 'application/json' }), 'fixture.json');
    const cancelled = await host.download(new Blob(['fixture']), 'cancel.json');
    channel.port1.close();
    return { text, saved, cancelled, actions };
  });
  expect(result).toEqual({ text: '中文 😃', saved: true, cancelled: false, actions: ['clipboard-read', 'export', 'export'] });
});

test('native Back closes the most recent dialog and unregisters disposed handlers', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { registerBackHandler, handleBack } = await import('/src/lib/host.ts');
    const closed: string[] = [];
    const first = registerBackHandler(() => closed.push('first'));
    const second = registerBackHandler(() => closed.push('second'));
    handleBack(); second(); handleBack(); first();
    return { closed, handled: handleBack() };
  });
  expect(result).toEqual({ closed: ['second', 'first'], handled: false });
});
