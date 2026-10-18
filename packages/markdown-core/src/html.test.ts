import { expect, it } from 'vitest';
import { sanitizeHtmlFragment } from './html.js';

it('uses the same HTML policy for raw blocks and fragments without running scripts', () => {
  const html = sanitizeHtmlFragment('<b onclick="bad()">yes</b><kbd>x</kbd><mark>m</mark><br><script>bad()</script><a href="javascript:bad()">link</a>');
  expect(html).toContain('<b>yes</b>');
  expect(html).toContain('<kbd>x</kbd>');
  expect(html).toContain('<mark>m</mark>');
  expect(html).not.toMatch(/onclick|javascript:|<script/);
});
