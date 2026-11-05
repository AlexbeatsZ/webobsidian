import type { IconNode } from 'lucide';
import { CALLOUT_SLOT, calloutIconSvg, pinnedCalloutIcon } from './callouts';
import { iconPaths } from './icons';
import { refreshBlockViews } from './blocks/model';

/**
 * Callout color/icon resolved through the Obsidian CSS contract:
 *
 *   .callout[data-callout="definition"] { --callout-color: 139, 92, 246; --callout-icon: lucide-book-open; }
 *
 * Native callouts deliberately do not carry the `.callout` class (Vault themes
 * restyle that class; see docs/design/callout-lists.md), so a hidden probe
 * element with that class reads the cascade instead. App CSS, Vault themes and
 * snippets all apply in their normal order. Unset values fall back to the
 * built-in slot tables in callouts.ts.
 */
export interface CalloutStyle { color: string; icon: string }

const cache = new Map<string, CalloutStyle>();
let probeRoot: HTMLElement | undefined;
let canvas: CanvasRenderingContext2D | null | undefined;
let lucide: Record<string, IconNode> | undefined;
let lucideLoading = false;
let watching = false;
let scheduled = false;

function fallback(type: string): CalloutStyle {
  const slot = CALLOUT_SLOT[type] ?? 'default';
  return { color: `var(--callout-${slot})`, icon: calloutIconSvg(slot) };
}

export function calloutStyle(type: string): CalloutStyle {
  const known = cache.get(type);
  if (known) return known;
  if (typeof document === 'undefined' || !document.body) return fallback(type);
  watch();
  const style = resolve(type);
  cache.set(type, style);
  return style;
}

function themeClass(): string {
  const host = document.querySelector<HTMLElement>('.theme-light:not(.callout-style-probe), .theme-dark:not(.callout-style-probe)');
  return host?.classList.contains('theme-dark') ? 'theme-dark' : 'theme-light';
}

function root(): HTMLElement {
  if (!probeRoot) {
    probeRoot = document.createElement('div');
    probeRoot.setAttribute('aria-hidden', 'true');
    probeRoot.style.display = 'none';
  }
  probeRoot.className = 'callout-style-probe ' + themeClass();
  if (probeRoot.parentElement !== document.body) document.body.append(probeRoot);
  return probeRoot;
}

function resolve(type: string): CalloutStyle {
  const base = fallback(type);
  const probe = document.createElement('div');
  probe.className = 'callout';
  probe.dataset.callout = type;
  root().append(probe);
  const computed = getComputedStyle(probe);
  const color = rgbTriplet(computed.getPropertyValue('--callout-color'));
  const icon = iconSvg(computed.getPropertyValue('--callout-icon'));
  probe.remove();
  return { color: color ?? base.color, icon: icon ?? base.icon };
}

/** Accepts Obsidian's `r, g, b` triplet and any CSS color (`rgb(...)`, `#hex`, names). */
export function rgbTriplet(value: string): string | undefined {
  const v = value.trim();
  if (!v) return undefined;
  const triplet = v.match(/^(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})$/);
  if (triplet) return triplet.slice(1, 4).join(', ');
  if (typeof CSS === 'undefined' || !CSS.supports('color', v)) return undefined;
  if (canvas === undefined) {
    const element = document.createElement('canvas'); element.width = element.height = 1;
    canvas = element.getContext('2d', { willReadFrequently: true });
  }
  if (!canvas) return undefined;
  canvas.clearRect(0, 0, 1, 1);
  canvas.fillStyle = '#000';
  canvas.fillStyle = v;
  canvas.fillRect(0, 0, 1, 1);
  const [r, g, b] = canvas.getImageData(0, 0, 1, 1).data;
  return `${r}, ${g}, ${b}`;
}

function unquote(value: string): string {
  const v = value.trim();
  return /^(['"]).*\1$/s.test(v) ? v.slice(1, -1).replace(/\\(["'\\])/g, '$1') : v;
}

const SVG_ATTRS = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

/** `lucide-name`, bare `name`, or inline `<svg>` markup; undefined when unresolved. */
function iconSvg(raw: string): string | undefined {
  const value = unquote(raw);
  if (!value || value === 'none') return undefined;
  if (value.startsWith('<svg')) return sanitizeSvg(value);
  const name = value.replace(/^lucide-/, '').toLowerCase();
  if (!/^[a-z0-9-]+$/.test(name)) return undefined;
  const pinned = pinnedCalloutIcon(name);
  if (pinned) return pinned;
  const node = lucide?.[pascal(name)];
  if (node) return `<svg ${SVG_ATTRS} data-lucide="${name}">${node.map(([tag, attrs]) =>
    `<${tag}${Object.entries(attrs).map(([key, val]) => ` ${key}="${escapeAttr(String(val))}"`).join('')}/>`).join('')}</svg>`;
  if (iconPaths[name]) return `<svg ${SVG_ATTRS} data-lucide="${name}">${iconPaths[name]}</svg>`;
  if (!lucide) loadLucide();
  return undefined;
}

function pascal(name: string): string {
  return name.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('');
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function sanitizeSvg(markup: string): string | undefined {
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  const svg = doc.documentElement;
  if (svg.nodeName !== 'svg' || doc.querySelector('parsererror')) return undefined;
  svg.querySelectorAll('script, foreignObject').forEach(node => node.remove());
  for (const element of [svg, ...svg.querySelectorAll('*')]) {
    for (const attr of [...element.attributes]) {
      if (/^on/i.test(attr.name) || /^\s*javascript:/i.test(attr.value)) element.removeAttribute(attr.name);
    }
  }
  return svg.outerHTML;
}

function loadLucide() {
  if (lucideLoading) return;
  lucideLoading = true;
  void import('lucide').then(module => {
    lucide = module.icons as Record<string, IconNode>;
    invalidate();
  }).catch(error => console.error('Lucide icons failed to load', error));
}

/** Re-resolve every seen type after theme/stylesheet changes; refresh editors only on a real change. */
function invalidate() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    let changed = false;
    for (const [type, before] of cache) {
      const after = resolve(type);
      if (after.color !== before.color || after.icon !== before.icon) { cache.set(type, after); changed = true; }
    }
    if (changed) refreshBlockViews();
  });
}

function watch() {
  if (watching) return;
  watching = true;
  // Theme class switches: App mirrors the theme onto body; harnesses use one wrapper.
  // Only these elements are observed, never the editor subtree.
  const themes = new MutationObserver(invalidate);
  const host = document.querySelector('.theme-light, .theme-dark');
  for (const element of new Set([document.body, host ?? document.body])) {
    themes.observe(element, { attributes: true, attributeFilter: ['class'] });
  }
  // Added/removed/edited stylesheets: plugins, Vault themes and CSS snippets.
  new MutationObserver(invalidate).observe(document.head,
    { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href', 'media', 'disabled'] });
  document.addEventListener('load', event => {
    if (event.target instanceof HTMLLinkElement || event.target instanceof HTMLStyleElement) invalidate();
  }, true);
}
