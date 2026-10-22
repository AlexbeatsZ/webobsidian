import { expect, it } from 'vitest';
import { renderNoteHtml } from './renderhtml.js';

it('renders native body titles in the no-JS fallback without treating literal code as headings', async () => {
  const html = await renderNoteHtml('paragraph\n####### 标题 **bold**\nbody\n\n```md\n####### literal\n```', x => x);
  expect(html).toContain('<div class="body-heading" role="heading" aria-level="7">标题 <strong>bold</strong></div>');
  expect(html).toContain('####### literal');
  expect(html).not.toContain('<h7');
});

it('retains list/quote structure and sanitizes body-heading content', async () => {
  const html = await renderNoteHtml('> ####### Quoted\n\n- ####### Listed\n\n####### Unsafe <script>alert(1)</script>', x => x);
  expect(html.match(/class="body-heading"/g)).toHaveLength(3);
  expect(html).toContain('<blockquote>');
  expect(html).toContain('<li>');
  expect(html).not.toContain('<script');
});
