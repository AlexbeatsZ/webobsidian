import type { MarkdownModel, SourceSpan } from '@webobsidian/markdown-core';

interface MarkdownImage extends SourceSpan { alt: string; altTo: number; target: string }
const markdownImages = new WeakMap<MarkdownModel, Map<number, MarkdownImage>>();

/** The existing grammar owns balanced destinations, including SVG data payloads. */
export function markdownImageAt(model: MarkdownModel, from: number): MarkdownImage | undefined {
  let images = markdownImages.get(model);
  if (!images) {
    images = new Map();
    for (const range of model.nodes) {
      if (range.name !== 'Image') continue;
      let image = model.tree.resolveInner(range.from, 1);
      while (image.name !== 'Image' && image.parent) image = image.parent;
      if (image.name !== 'Image' || image.from !== range.from) continue;
      const destination = image.getChild('URL'), closingAlt = image.getChildren('LinkMark')[1];
      if (!destination || !closingAlt) continue;
      images.set(range.from, { from: range.from, to: range.to,
        alt: model.text.slice(range.from + 2, closingAlt.from),
        altTo: closingAlt.from,
        target: model.text.slice(destination.from, destination.to).replace(/^<|>$/g, ''),
      });
    }
    markdownImages.set(model, images);
  }
  return images.get(from);
}

/** Presentation metadata is kept separate from the resolved/request URL. */
export function imagePresentation(target: string, alt: string) {
  const dataImage = /^data:image\//i.test(target);
  // Encoded SVG text/base64 is image content, never a filename/theme marker.
  const presentation = dataImage ? '' : target;
  const path = presentation.split(/[?#]/)[0];
  let scale = 1;
  for (const value of [1.5, 2, 0.5]) if (presentation.includes('#x' + value)) scale = value;
  return {
    target, alt,
    // Preserve the active STEM rule: only .jpg/.png filename alts are suppressed.
    caption: alt && !alt.endsWith('.jpg') && !alt.endsWith('.png') ? alt : '',
    svg: /\.svg$/i.test(path) || /^data:image\/svg\+xml(?:[;,])/i.test(target),
    center: presentation.includes('#center'), full: presentation.includes('#full'), scale,
    dark: presentation.includes('dark'), wiki: presentation.includes('Wiki'),
  };
}

export function applyImagePresentation(wrap: HTMLElement, target: string, alt: string): void {
  const image = imagePresentation(target, alt);
  wrap.classList.add('cm-image-wrap');
  wrap.dataset.imageSource = target;
  wrap.dataset.imageCaption = image.caption;
  for (const key of ['svg', 'center', 'full', 'dark', 'wiki'] as const) {
    wrap.toggleAttribute('data-image-' + key, image[key]);
  }
  wrap.style.setProperty('--image-scale', String(image.scale));
}

/** HTML images receive the same presentation as Markdown images after sanitizing. */
export function presentHtmlImages(host: HTMLElement, targets: string[], onLoad: () => void): void {
  host.querySelectorAll('img').forEach((img, index) => {
    const wrap = img.ownerDocument.createElement('span');
    applyImagePresentation(wrap, targets[index] ?? img.getAttribute('src') ?? '', img.alt);
    img.classList.add('cm-embed-image');
    img.replaceWith(wrap); wrap.appendChild(img);
    img.addEventListener('load', onLoad, { once: true });
    img.addEventListener('error', onLoad, { once: true });
  });
  for (const wrap of host.querySelectorAll('.cm-image-wrap')) {
    const row = wrap.parentElement!;
    if ([...row.childNodes].every(node => node.nodeType === 3 ? !node.textContent?.trim() : node instanceof Element && node.classList.contains('cm-image-wrap'))) {
      row.classList.add('cm-image-row');
    }
  }
}
