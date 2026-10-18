/** Presentation metadata is kept separate from the resolved/request URL. */
export function imagePresentation(target: string, alt: string) {
  const path = target.split(/[?#]/)[0];
  let scale = 1;
  for (const value of [1.5, 2, 0.5]) if (target.includes('#x' + value)) scale = value;
  return {
    target, alt,
    // Preserve the active STEM rule: only .jpg/.png filename alts are suppressed.
    caption: alt && !alt.endsWith('.jpg') && !alt.endsWith('.png') ? alt : '',
    svg: /\.svg$/i.test(path),
    center: target.includes('#center'), full: target.includes('#full'), scale,
    dark: target.includes('dark'), wiki: target.includes('Wiki'),
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
