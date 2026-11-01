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
  it('ranks names like fuzzy-chinese: coverage and early continuous matches first', () => {
    const names = [
      'fudan-vpn-docker-clash-wsl-proxy-diagnosis',
      '热力学中所有偏微分的求解',
      '热力学势的讨论',
      'RNA的结构、转录与代谢',
    ];
    const ranked = names
      .map((name) => ({ name, match: matchText('rlx', name) }))
      .filter((item) => item.match)
      .sort((a, b) => b.match!.score - a.match!.score)
      .map((item) => item.name);
    expect(ranked.slice(0, 2)).toEqual(['热力学势的讨论', '热力学中所有偏微分的求解']);
    expect(ranked.at(-1)).toBe('fudan-vpn-docker-clash-wsl-proxy-diagnosis');
    expect(matchText('rlx', '热力学势的讨论')?.matches).toEqual([[0, 3]]);
  });
  it('matches full readings, zh/ch/sh initials, a trailing reading prefix and single-letter readings', () => {
    expect(matchText('relixue', '热力学')?.matches).toEqual([[0, 3]]);
    expect(matchText('zhs', '张三')?.matches).toEqual([[0, 2]]);
    expect(matchText('zhangs', '张三')?.kind).toBe('pinyin');
    expect(matchText('rel', '热力学')?.matches).toEqual([[0, 2]]);
    expect(matchText('ae', '啊额')?.matches).toEqual([[0, 2]]);
    expect(matchText('rlx', '热力学', { enabled: false })).toBeNull();
  });
});
