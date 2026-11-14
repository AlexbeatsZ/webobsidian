import { isAndroid } from './platform';

let androidPort: MessagePort | undefined;
let sequence = 0;
const requests = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
let portReady: (() => void) | undefined;
const ready = new Promise<void>(resolve => { portReady = resolve; });
if (typeof window !== 'undefined') window.addEventListener('message', event => {
  if (event.data !== 'webobsidian-host' || !event.ports[0] || !isAndroid() || androidPort) return;
  androidPort = event.ports[0];
  androidPort.onmessage = event => {
    const message = JSON.parse(event.data) as { id: number; value?: unknown; error?: string };
    const pending = requests.get(message.id);
    requests.delete(message.id);
    if (message.error) pending?.reject(new Error(message.error)); else pending?.resolve(message.value);
  };
  portReady?.();
});

async function androidRequest(action: string, input?: unknown): Promise<unknown> {
  await Promise.race([ready, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Android 宿主尚未连接')), 10_000))]);
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    requests.set(id, { resolve, reject });
    androidPort!.postMessage(JSON.stringify({ id, action, input }));
  });
}

export const host = {
  onBeforeClose(listener: () => Promise<void>): (() => void) | undefined {
    return window.webobsidianDesktop?.onBeforeClose(listener);
  },
  setChrome(dark: boolean, workspace: boolean): void { window.webobsidianDesktop?.setChrome?.(dark, workspace); },
  async readClipboardText(): Promise<string> {
    return isAndroid() ? String(await androidRequest('clipboard-read')) : navigator.clipboard.readText();
  },
  async download(blob: Blob, filename: string): Promise<boolean> {
    if (isAndroid()) {
      if (blob.size > 24 * 1024 * 1024) throw new Error('导出文件超过 24 MiB');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 8192)
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
      return Boolean(await androidRequest('export', { filename, mime: blob.type.split(';')[0], base64: btoa(binary) }));
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  },
};

const backHandlers: (() => void)[] = [];
export function registerBackHandler(close: () => void): () => void {
  backHandlers.push(close);
  return () => { const index = backHandlers.indexOf(close); if (index >= 0) backHandlers.splice(index, 1); };
}
export function handleBack(): boolean {
  const close = backHandlers.at(-1);
  if (!close) return false;
  close();
  return true;
}
