import { expect, it } from 'vitest';
import { analyzeMarkdown } from './syntax.js';
import { extractMetadata } from './metadata.js';
import { fragmentRange } from './fragments.js';
import { legacySubheadings, legacySubheadingRange } from './legacySubheadings.js';
import { blockContainers } from './blocks.js';

it('shares parsed exclusions and retains duplicate legacy targets without changing source', () => {
  const source = '# H\n\n> **A**\n\nbody\n\n> **A**\n\n```js\n> **inert**\n```\n\n%%\n> **hidden**\n%%';
  const model = analyzeMarkdown(source), meta = extractMetadata(model);
  const subheadings = legacySubheadings(model, meta.comments);
  expect(subheadings.map(item => item.fragment)).toEqual(['-A', '-A 1']);
  expect(fragmentRange(model, '-A')).toBeNull();
  expect(legacySubheadingRange(model, '-A')?.from).toBe(source.indexOf('> **A**'));
  expect(legacySubheadingRange(model, '-A%201')?.from).toBe(source.lastIndexOf('> **A**'));
  expect(model.text).toBe(source);
  expect(blockContainers(model)).toBe(blockContainers(model));
});
