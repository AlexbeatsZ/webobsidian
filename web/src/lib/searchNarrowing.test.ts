import { describe, expect, it } from 'vitest';
import type { CatalogEntry } from '@webobsidian/search-core';
import { fileCandidates } from './search';

const entry = (path: string, title = path.split('/').at(-1)!.replace(/\.md$/, ''), aliases: string[] = [], tags: string[] = []): CatalogEntry =>
  ({ path, kind: 'file', title, aliases, tags, headings: [] });
const catalog: CatalogEntry[] = [
  entry('物理/物理化学.md'), entry('物理与化学.md'), entry('张三的笔记.md', '张三的笔记', ['zs']),
  entry('重庆旅行.md', '重庆旅行', [], ['旅行']), entry('中文搜索.md'), entry('Zhang San.md'),
  entry('数学/线性代数.md', '线性代数', [], ['数学']), entry('附件/图片.png', '图片.png'),
];
const ids = (items: ReturnType<typeof fileCandidates>) => items.map(({ entry, label, match }) => [entry.path, label, match.score, match.matches]);

describe('quick switcher narrowing', () => {
  it('returns exactly the fresh result while typing, deleting and changing filters', () => {
    const typed = ['z', 'zh', 'zha', 'zhang', 'zhangs', 'zhangsan', 'zhang', 'w', 'wl', 'wlhx', 'cq', 'cq #旅行', 'xx', 'xxds', '#数学 xx'];
    // A new array identity never reuses cached prefixes, so this is the full scan.
    const fresh = typed.map(query => ids(fileCandidates(query, [...catalog])));
    const narrowed = typed.map(query => ids(fileCandidates(query, catalog)));
    expect(narrowed).toEqual(fresh);
    expect(fileCandidates('zhangsan', catalog).map(({ entry }) => entry.path)).toContain('张三的笔记.md');
  });
});
