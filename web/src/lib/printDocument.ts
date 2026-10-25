import type { DocumentSnapshot } from '@webobsidian/markdown-core';
import { mountMarkdownFragment } from '../components/MarkdownFragment';
import { nonExecutingContext, type RenderContext } from './renderContext';
import { RenderLifetime } from './obsidian/renderLifetime';

type PrintOptions = { document?: Document; signal?: AbortSignal; timeoutMs?: number };

/** A dedicated output host gives the shared engine a viewport for every line. */
export async function preparePrintDocument(snapshot: DocumentSnapshot, context: RenderContext, options: PrintOptions = {}): Promise<{ frame: HTMLIFrameElement; dispose: () => void }> {
  if (options.signal?.aborted) throw new DOMException('打印已取消', 'AbortError');
  const sourceDoc = options.document ?? document, win = sourceDoc.defaultView!;
  const lifetime = new RenderLifetime(); void lifetime.load();
  const frame = sourceDoc.createElement('iframe'); frame.className = 'note-print-frame';
  Object.assign(frame.style, { position: 'fixed', width: '800px', height: '2000px', left: '0', top: '0', opacity: '0', pointerEvents: 'none', zIndex: '-1', border: '0' });
  sourceDoc.body.appendChild(frame);
  const doc = frame.contentDocument!;
  let failure: Error = new DOMException('打印已取消', 'AbortError');
  const cancelled = new Promise<never>((_resolve, reject) => lifetime.signal.addEventListener('abort', () => reject(failure), { once: true }));
  const wait = <Value,>(work: PromiseLike<Value>) => Promise.race([work, cancelled]);
  let stop: (() => void) | undefined;
  const dispose = () => lifetime.unload();
  const cancel = () => dispose();
  options.signal?.addEventListener('abort', cancel, { once: true });
  lifetime.register(() => options.signal?.removeEventListener('abort', cancel));
  lifetime.register(() => frame.remove());
  lifetime.register(() => stop?.());
  const timeout = win.setTimeout(() => { failure = new Error('打印资源或整页布局未加载完成'); dispose(); }, options.timeoutMs ?? 20000);
  lifetime.register(() => win.clearTimeout(timeout));
  let pendingFrame: number | undefined;
  lifetime.register(() => { if (pendingFrame !== undefined) win.cancelAnimationFrame(pendingFrame); });
  const nextFrame = () => new Promise<void>(resolve => {
    pendingFrame = win.requestAnimationFrame(() => { pendingFrame = undefined; resolve(); });
  });
  const styles = new Map<string, Promise<void>>();
  const copyStyles = () => {
    for (const source of sourceDoc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')) {
      if (styles.has(source.href)) continue;
      const link = source.cloneNode(true) as HTMLLinkElement;
      const loading = new Promise<void>((resolve, reject) => {
        const loaded = () => { cleanup(); resolve(); };
        const failed = () => { cleanup(); reject(new Error('打印样式加载失败：' + link.href)); };
        const cleanup = () => { link.removeEventListener('load', loaded); link.removeEventListener('error', failed); };
        link.addEventListener('load', loaded); link.addEventListener('error', failed);
        lifetime.register(cleanup); doc.head.appendChild(link);
        if (link.sheet) loaded();
      });
      styles.set(source.href, loading);
    }
    for (const source of sourceDoc.querySelectorAll('style')) {
      if (![...doc.querySelectorAll('style')].some(copy => copy.textContent === source.textContent)) doc.head.appendChild(source.cloneNode(true));
    }
    return Promise.all(styles.values());
  };
  try {
    doc.title = snapshot.id.split('/').pop() ?? 'Note';
    await wait(copyStyles());
    const style = doc.createElement('style');
    style.textContent = 'html,body{height:auto!important;overflow:visible!important} .cm-host,.cm-editor,.cm-scroller,.cm-content{height:auto!important;overflow:visible!important;max-height:none!important;min-height:0!important}.cm-line{break-inside:avoid}.cm-content{padding:0!important}@page{margin:16mm}';
    doc.head.appendChild(style);
    const host = doc.createElement('div'); host.className = sourceDoc.querySelector('.theme-dark') ? 'theme-dark' : 'theme-light'; doc.body.appendChild(host);
    await wait(new Promise<void>((resolve, reject) => { stop = mountMarkdownFragment(host, snapshot.text, { id: snapshot.id,
      equations: context.equations, mathSource: context.mathSource, context: nonExecutingContext(context), onReady: resolve, onError: reject }); }));
    let stable = 0;
    while (stable < 3) {
      lifetime.assertActive();
      const height = Math.ceil(Math.max(doc.body.scrollHeight + 2000, 2000));
      if (host.querySelector('.cm-gap') && height > parseFloat(frame.style.height)) { frame.style.height = height + 'px'; frame.contentWindow!.dispatchEvent(new Event('resize')); stable = 0; }
      await wait(nextFrame());
      await wait(copyStyles());
      const images = [...host.querySelectorAll<HTMLImageElement>('img:not(.cm-widgetBuffer)')];
      if (host.querySelector('[data-render-error],.cm-mermaid.mod-error') || images.some(img => img.complete && !img.naturalWidth)) throw new Error('打印图片或图表加载失败');
      const pending = host.querySelector('[data-render-pending],.cm-gap') || images.some(img => !img.complete) || doc.fonts.status === 'loading';
      stable = pending ? 0 : stable + 1;
    }
    await wait(doc.fonts.ready);
    if ([...doc.fonts].some(font => font.status === 'error')) throw new Error('打印字体加载失败');
    const frozen = host.cloneNode(true) as HTMLElement;
    frozen.querySelectorAll('.cm-cursorLayer,.cm-selectionLayer,.cm-panels,.cm-tooltip,.cm-source-toggle,.cm-image-resize').forEach(el => el.remove());
    frozen.querySelectorAll('[contenteditable]').forEach(el => el.setAttribute('contenteditable', 'false'));
    stop?.(); stop = undefined; host.remove(); doc.body.appendChild(frozen);
    frame.style.height = '600px'; win.clearTimeout(timeout);
    return { frame, dispose };
  } catch (error) { dispose(); throw error; }
}

export async function printDocument(snapshot: DocumentSnapshot, context: RenderContext): Promise<void> {
  const prepared = await preparePrintDocument(snapshot, context);
  try { prepared.frame.contentWindow!.focus(); prepared.frame.contentWindow!.print(); }
  finally { prepared.dispose(); }
}
