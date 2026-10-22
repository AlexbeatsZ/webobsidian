import { fromHtml } from 'hast-util-from-html';
import { sanitize, defaultSchema, type Schema } from 'hast-util-sanitize';
import { toHtml } from 'hast-util-to-html';

/** Shared user-HTML policy. Library-generated math/SVG uses controlled generators. */
export const htmlSchema: Schema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'mark', 'u', 'kbd', 'video', 'audio', 'source'],
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'className'],
    a: [...(defaultSchema.attributes?.a ?? []).filter((rule) => !(Array.isArray(rule) && rule[0] === 'className')), 'className', 'dataWikilink', 'dataHref'],
    div: [...(defaultSchema.attributes?.div ?? []), 'className', 'dataCallout', 'dataCalloutFold', ['role', 'heading'], ['ariaLevel', 7]],
    span: [...(defaultSchema.attributes?.span ?? []), 'className', 'dataTex', 'dataTexDisplay', 'dataCalloutIcon'],
    li: [...(defaultSchema.attributes?.li ?? []), 'dataTask'],
    input: ['type', 'checked', 'disabled', 'className', 'dataTask'],
    video: ['src', 'controls', 'preload', 'width', 'height', 'className', 'loop', 'playsInline'],
    audio: ['src', 'controls', 'preload', 'className', 'loop'],
    source: ['src', 'type'],
  },
};

export function sanitizeHtmlFragment(html: string, mediaUrl?: (target: string) => string): string {
  const tree = sanitize(fromHtml(html, { fragment: true }), htmlSchema);
  const visit = (node: ReturnType<typeof sanitize>) => {
    if (node.type === 'element' && ['img', 'video', 'audio', 'source'].includes(node.tagName) && typeof node.properties.src === 'string' && mediaUrl && !/^(?:https?:|data:|blob:)/i.test(node.properties.src)) node.properties.src = mediaUrl(node.properties.src);
    if ('children' in node) node.children.forEach(visit);
  };
  visit(tree);
  return toHtml(tree);
}

export function htmlMediaTargets(html: string): string[] {
  const targets: string[] = [];
  sanitizeHtmlFragment(html, target => { targets.push(target); return target; });
  return targets;
}

export function decodeHtmlEntity(entity: string): string {
  return fromHtml(entity, { fragment: true }).children.map((node) => node.type === 'text' ? node.value : '').join('');
}
