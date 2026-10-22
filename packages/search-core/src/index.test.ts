import { describe, expect, it } from 'vitest';
import { candidateTokens, findText, matchText, phoneticTokens } from './index.js';

describe('shared Chinese search contract', () => {
  for (const query of ['wulihuaxue', 'wlhx', 'wuli hx', '物理hx'])
    it(`matches ${query} in source coordinates`, () => {
      expect(findText(query, '😀物理化学')[0]?.matches).toEqual([[2, 6]]);
      const tokens = new Set(phoneticTokens('😀物理化学'));
      expect(candidateTokens(query).every((t) => tokens.has(t))).toBe(true);
    });
  it('keeps all polyphonic candidates without expanding whole strings', () => {
    expect(findText('chongqing', '重庆').length).toBeGreaterThan(0);
    expect(findText('zhong', '重庆').length).toBeGreaterThan(0);
  });
  it('does not turn literal mode into transliteration', () => {
    expect(findText('wlhx', '物理化学', { enabled: false })).toEqual([]);
    expect(matchText('物理', '物理化学')?.kind).toBe('literal');
  });
  it('uses gap matching only for names', () => {
    expect(findText('wlhx', '物理与化学')).toEqual([]);
    expect(matchText('wlhx', '物理与化学')).not.toBeNull();
  });
  it('maps repeated matches to UTF-16 ranges', () => {
    expect(findText('hx', '化学和化学').map((m) => m.matches[0])).toEqual([
      [0, 2],
      [3, 5],
    ]);
  });
  it('applies explicitly requested fuzzy sounds', () => {
    expect(findText('zong', '中', { fuzzyRules: [['zh', 'z']] }).length).toBeGreaterThan(0);
  });
});
