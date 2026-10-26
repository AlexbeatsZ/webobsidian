import { describe, expect, it, vi } from 'vitest';
import { getSearchResultHighlights, publishSearchResultHighlights, subscribeSearchResultHighlights } from './search';

describe('shared search result highlights', () => {
  it('reuses the search result snapshot and stops notifying disposed consumers', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSearchResultHighlights(listener);
    const matches = new Map([['note.md', { path: 'note.md', count: 1, contexts: [], sourceRanges: [{ from: 0, to: 4, text: 'test' }] }]]);
    publishSearchResultHighlights('test', matches);
    expect(getSearchResultHighlights().matches).toBe(matches);
    publishSearchResultHighlights('test', matches);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    publishSearchResultHighlights('', new Map());
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getSearchResultHighlights().query).toBe('');
  });
});
