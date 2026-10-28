import type { RenderOptions } from 'pele';

let engine: Promise<typeof import('pele')> | undefined;
export const diagramRenderer = {
  async render(id: string, source: string, host?: HTMLElement, signal?: AbortSignal) {
    engine ??= import('pele').catch(error => { engine = undefined; throw error; });
    const pele = await engine;
    signal?.throwIfAborted();
    const options: RenderOptions = { idPrefix: id, fontSize: 16, links: false, images: false };
    if (host) {
      const style = host.ownerDocument.defaultView!.getComputedStyle(host);
      options.fontFamily = style.getPropertyValue('--font-text').trim() || style.fontFamily;
      options.fontFamilyMono = style.getPropertyValue('--font-mono').trim() || 'monospace';
      await host.ownerDocument.fonts.load(`16px ${options.fontFamily}`);
    }
    signal?.throwIfAborted();
    return pele.render(source, options);
  },
};
