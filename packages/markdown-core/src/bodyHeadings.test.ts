import { describe, expect, it } from 'vitest';
import { analyzeMarkdown, updateMarkdown } from './syntax.js';
import { extractMetadata, fragmentRange } from './metadata.js';
import { mathRegions } from './math.js';

describe('native body-local headings', () => {
  it('parses exactly seven hashes, inline markup and optional closing hashes', () => {
    const model = analyzeMarkdown('paragraph\n####### 正文 **标题** ###\nbody\n######## ordinary\n#######no-space');
    expect(model.nodes.filter(n => n.name === 'BodyHeading')).toHaveLength(1);
    expect(model.nodes.some(n => n.name === 'StrongEmphasis')).toBe(true);
    expect(extractMetadata(model).headings).toEqual([
      expect.objectContaining({ level: 7, kind: 'body', text: '正文 **标题**' }),
    ]);
    expect(extractMetadata('#######\n#######   ').headings.map(h => h.text)).toEqual(['', '']);
  });

  it('uses the grammar to exclude literal code/HTML and metadata to exclude comments/YAML', () => {
    const source = ['---', 'title: yaml', '####### YAML', '---', '',
      '```md', '####### fence', '```', '', '    ####### indented', '',
      '`####### inline`', '', '<div>', '####### HTML', '</div>', '',
      '%%', '####### comment', '%%', '', '> ####### quoted', '', '- ####### listed'].join('\n');
    expect(extractMetadata(source).headings.map(h => h.text)).toEqual(['quoted', 'listed']);
  });

  it('reuses normal heading fragments and ends at the next body or structural title', () => {
    const source = '# Chapter\nintro\n####### 局部一\nfirst\n####### 局部二\nsecond\n## Section\nlast';
    const model = analyzeMarkdown(source);
    const first = fragmentRange(model, encodeURIComponent('局部一'))!;
    expect(source.slice(first.from, first.to)).toBe('####### 局部一\nfirst\n');
    const second = fragmentRange(model, '局部二')!;
    expect(source.slice(second.from, second.to)).toBe('####### 局部二\nsecond\n');
    const chapter = fragmentRange(model, 'chapter')!;
    expect(source.slice(chapter.from, chapter.to)).toBe(source);
  });

  it('reclassifies a line when incremental edits add or remove the seventh hash', () => {
    const before = 'prefix\n###### 标题\nbody';
    const at = before.indexOf('######');
    const after = before.slice(0, at) + '#' + before.slice(at);
    const first = analyzeMarkdown(before);
    const next = updateMarkdown(first, after, [{ fromA: at, toA: at, fromB: at, toB: at + 1 }]);
    expect(extractMetadata(next).headings[0]).toMatchObject({ level: 7, kind: 'body', text: '标题' });
    const restored = updateMarkdown(next, before, [{ fromA: at, toA: at + 1, fromB: at, toB: at }]);
    expect(extractMetadata(restored).headings[0]).toMatchObject({ level: 6, text: '标题' });
    expect(restored.nodes.some(n => n.name === 'BodyHeading')).toBe(false);
  });

  it('does not swallow a following body title into an unclosed display formula', () => {
    const model = analyzeMarkdown('$$ unfinished\n####### Title\n$x$');
    const regions = mathRegions(model);
    expect(regions[0]).toMatchObject({ closed: false, tex: ' unfinished' });
    expect(regions[1]).toMatchObject({ closed: true, tex: 'x' });
  });
});
