import { expect, it } from 'vitest';
import { extractMetadata } from './metadata.js';

it('shares Unicode tags, headings and real links without indexing code or comments', () => {
  const value = '# Heading\n\n#中文标签 [[Real#Title|alias]] [relative](../Note.md)\n\n`[[code]] #fake`\n\n%%[[hidden]] #hidden%%\n\n```md\n# Fake\n[[fenced]]\n```';
  const meta = extractMetadata(value);
  expect(meta.tags).toEqual(['中文标签']);
  expect(meta.links).toEqual(['Real#Title', '../Note.md']);
  expect(meta.headings.map((heading) => heading.text)).toEqual(['Heading']);
});
