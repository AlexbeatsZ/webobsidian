import { expect, it } from 'vitest';
import { analyzeMarkdown } from './syntax.js';

it('recognizes HTML break positions while keeping code and escaped tags literal', () => {
  const text = '甲<br />乙\n\n`<br>`\n\n\\<br>\n\n```html\n<br>\n```';
  const model = analyzeMarkdown(text);
  expect(model.html.filter((token) => token.tag === 'br').map((token) => text.slice(token.from, token.to)))
    .toEqual(['<br />']);
});
