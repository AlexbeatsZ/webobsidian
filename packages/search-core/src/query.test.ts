import { describe, expect, it } from 'vitest';
import { fileTitleError, matchesTagFilters, parseSearchQuery, parseTagFilters, withTagFilter } from './query.js';

describe('one file/body tag query grammar', () => {
  it('ANDs multiple tags and excludes descendants without matching sibling prefixes', () => {
    const filters = parseSearchQuery('量子 #150化学 #笔记 -#150化学/旧版');
    expect(filters.filterText).toBe('量子');
    expect(matchesTagFilters(['150化学/物理', '笔记'], filters)).toBe(true);
    expect(matchesTagFilters(['150化学/旧版/热学', '笔记'], filters)).toBe(false);
    expect(matchesTagFilters(['150化学-other', '笔记'], filters)).toBe(false);
    expect(matchesTagFilters(['150化学'], filters)).toBe(false);
  });
  it('retains old explicit syntax and exact case-insensitive hierarchy semantics', () => {
    expect(parseTagFilters('tag:#Science -tags:Science/old')).toEqual({ text: '', include: ['Science'], exclude: ['Science/old'] });
    expect(matchesTagFilters(['SCIENCE/physics'], parseTagFilters('#science'))).toBe(true);
    expect(withTagFilter('量子 -tag:#Science #笔记', 'science', 'include')).toBe('量子  #笔记 #science');
  });
  it('does not consume quoted hashes, hashes inside words, incomplete or invalid tags', () => {
    const query = parseSearchQuery('"#literal" C# # -# #bad//tag #化学');
    expect(query.filterText).toBe('#literal C# # -# #bad//tag');
    expect(query.include).toEqual(['化学']);
  });
  it('shares field scopes but does not treat unknown operators as filters', () => {
    expect(parseSearchQuery('path:课程 #化学').fields).toEqual(['path']);
    expect(parseSearchQuery('body:反应 -#旧版').filterText).toBe('反应');
    expect(parseSearchQuery('unknown:内容').filterText).toBe('unknown:内容');
  });
  it('reserves hashes in the file title without rejecting an existing parent folder', () => {
    expect(fileTitleError('课程/量子#化学.md')).toContain('不能包含 #');
    expect(fileTitleError('旧#目录/量子化学.md')).toBeUndefined();
  });
});
