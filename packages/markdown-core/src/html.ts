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
    div: [...(defaultSchema.attributes?.div ?? []), 'className', 'dataCallout', 'dataCalloutFold'],
    span: [...(defaultSchema.attributes?.span ?? []), 'className', 'dataTex', 'dataTexDisplay', 'dataCalloutIcon'],
    li: [...(defaultSchema.attributes?.li ?? []), 'dataTask'],
    input: ['type', 'checked', 'disabled', 'className', 'dataTask'],
    video: ['src', 'controls', 'preload', 'width', 'height', 'className', 'loop', 'playsInline'],
    audio: ['src', 'controls', 'preload', 'className', 'loop'],
    source: ['src', 'type'],
  },
};

export function sanitizeHtmlFragment(html: string): string {
  return toHtml(sanitize(fromHtml(html, { fragment: true }), htmlSchema));
}

export function decodeHtmlEntity(entity: string): string {
  return fromHtml(entity, { fragment: true }).children.map((node) => node.type === 'text' ? node.value : '').join('');
}
