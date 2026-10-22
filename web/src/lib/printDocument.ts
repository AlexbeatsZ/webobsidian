import type { DocumentSnapshot } from '@webobsidian/markdown-core';
import { mountMarkdownFragment } from '../components/MarkdownFragment';
import { nonExecutingContext, type RenderContext } from './renderContext';

const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

/** A dedicated output host gives the shared engine a viewport for every line. */
export async function preparePrintDocument(snapshot: DocumentSnapshot, context: RenderContext): Promise<{ frame: HTMLIFrameElement; dispose: () => void }> {
  const frame = document.createElement('iframe'); frame.className = 'note-print-frame';
  Object.assign(frame.style, { position: 'fixed', width: '800px', height: '2000px', left: '0', top: '0', opacity: '0', pointerEvents: 'none', zIndex: '-1', border: '0' });
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.title = snapshot.id.split('/').pop() ?? 'Note';
  document.querySelectorAll('style,link[rel="stylesheet"]').forEach(el => doc.head.appendChild(el.cloneNode(true)));
  const style = doc.createElement('style');
  style.textContent = 'html,body{height:auto!important;overflow:visible!important} .cm-host,.cm-editor,.cm-scroller,.cm-content{height:auto!important;overflow:visible!important;max-height:none!important;min-height:0!important}.cm-line{break-inside:avoid}.cm-content{padding:0!important}@page{margin:16mm}';
  doc.head.appendChild(style);
  const host = doc.createElement('div'); host.className = document.querySelector('.theme-dark') ? 'theme-dark' : 'theme-light'; doc.body.appendChild(host);
  let stop: (() => void) | undefined;
  const dispose = () => { stop?.(); frame.remove(); };
  try {
    await Promise.all([...doc.querySelectorAll('link')].map(link => link.sheet ? Promise.resolve() : new Promise<void>(resolve => { link.onload = () => resolve(); link.onerror = () => resolve(); })));
    await new Promise<void>(resolve => { stop = mountMarkdownFragment(host, snapshot.text, { id: snapshot.id, context: nonExecutingContext(context), onReady: resolve }); });
    const deadline = performance.now() + 20000; let stable = 0;
    while (stable < 3) {
      const height = Math.ceil(Math.max(doc.body.scrollHeight + 2000, 2000));
      if (host.querySelector('.cm-gap') && height > parseFloat(frame.style.height)) { frame.style.height = height + 'px'; frame.contentWindow!.dispatchEvent(new Event('resize')); stable = 0; }
      await nextFrame();
      // Copy any styles added by lazy renderers after the print host was mounted.
      document.querySelectorAll('link[rel="stylesheet"]').forEach(el => {
        const href = (el as HTMLLinkElement).href;
        if (![...doc.querySelectorAll('link')].some(link => link.href === href)) doc.head.appendChild(el.cloneNode(true));
      });
      document.querySelectorAll('style').forEach(el => {
        if (![...doc.querySelectorAll('style')].some(copy => copy.textContent === el.textContent)) doc.head.appendChild(el.cloneNode(true));
      });
      const pending = host.querySelector('[data-render-pending],.cm-gap') || [...host.querySelectorAll('img')].some(img => !img.complete) || doc.fonts.status === 'loading';
      stable = pending ? 0 : stable + 1;
      if (performance.now() > deadline) throw new Error('Print resources or full layout did not finish loading');
    }
    await doc.fonts.ready;
    const frozen = host.cloneNode(true) as HTMLElement;
    frozen.querySelectorAll('.cm-cursorLayer,.cm-selectionLayer,.cm-panels,.cm-tooltip,.cm-source-toggle,.cm-image-resize').forEach(el => el.remove());
    frozen.querySelectorAll('[contenteditable]').forEach(el => el.setAttribute('contenteditable', 'false'));
    stop?.(); stop = undefined; host.remove(); doc.body.appendChild(frozen);
    frame.style.height = '600px';
    return { frame, dispose };
  } catch (error) { dispose(); throw error; }
}

export async function printDocument(snapshot: DocumentSnapshot, context: RenderContext): Promise<void> {
  const prepared = await preparePrintDocument(snapshot, context);
  try { prepared.frame.contentWindow!.focus(); prepared.frame.contentWindow!.print(); }
  finally { prepared.dispose(); }
}
