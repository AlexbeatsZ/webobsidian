import { expect, it } from 'vitest';
import { analyzeMarkdown } from './syntax.js';
import { blockContainers, mathBlocks } from './blocks.js';

it('keeps nested callout ownership and quoted display math in source coordinates', () => {
  const model = analyzeMarkdown('> [!note] Outer\n> body\n> > [!warning]- Inner\n> > $$\n> > x^2\n> > $$\n\n```\n$$\nnot math\n$$\n```');
  const containers = blockContainers(model);
  expect(containers.filter((container) => container.kind === 'callout').map((container) => [container.type, container.depth]))
    .toEqual([['note', 1], ['warning', 2]]);
  expect(mathBlocks(model).map((block) => block.tex)).toEqual(['x^2']);
});
