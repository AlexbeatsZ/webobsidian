import { describe, expect, it } from 'vitest';
import { emptyFolderTags, folderRuleTags, normalizeFolderTags, planFolderTags } from './folderRules.js';

describe('folder tag rules', () => {
  const settings = { enabled: true, pruneAncestors: true, rules: [
    { folder: '04资料', tags: ['_资料', '自有'], recursive: true },
    { folder: '04资料/AI', tags: ['_资料/AI'], recursive: true },
  ] };
  it('unions ancestor rules with complete path-segment matching', () => {
    expect(folderRuleTags('04资料/AI/topic.md', settings)).toEqual(['_资料', '自有', '_资料/AI']);
    expect(folderRuleTags('04资料库/topic.md', settings)).toEqual([]);
    expect(folderRuleTags('04资料/AI/topic.canvas', settings)).toEqual([]);
  });
  it('supports exact folder and root coverage', () => {
    const exact = { ...settings, rules: [{ folder: '', tags: ['root'], recursive: false }] };
    expect(folderRuleTags('a.md', exact)).toEqual(['root']);
    expect(folderRuleTags('sub/a.md', exact)).toEqual([]);
  });
  it('preserves source bytes and prunes only YAML ancestor tags', () => {
    const raw = '\ufeff---\r\ntags: ["_资料", "other"]\r\ntitle: "keep"\r\n---\r\n正文 #_资料\n';
    const plan = planFolderTags(raw, '04资料/AI/a.md', settings);
    expect(plan.raw).not.toContain('"_资料",');
    expect(plan.raw).toContain('_资料/AI'); expect(plan.raw).toContain('other');
    expect(plan.raw).toContain('title: "keep"\r\n---\r\n正文 #_资料\n');
    expect(plan.raw.startsWith('\ufeff')).toBe(true);
    expect(planFolderTags(plan.raw, '04资料/AI/a.md', settings).changes).toEqual([]);
  });
  it('can retain parent tags and leaves unrelated notes unchanged', () => {
    const plan = planFolderTags('body', '04资料/AI/a.md', { ...settings, pruneAncestors: false });
    expect(plan.raw).toContain('"_资料"'); expect(plan.raw).toContain('"_资料/AI"');
    expect(planFolderTags('body', 'else/a.md', settings).raw).toBe('body');
    expect(emptyFolderTags()).toEqual({ enabled: false, pruneAncestors: true, rules: [] });
  });
  it('retains unknown tag strings while removing only an ancestor token', () => {
    const raw = '---\ntags: ["_资料", "123", "keep!"]\n---\nbody';
    const plan = planFolderTags(raw, '04资料/AI/a.md', settings);
    expect(plan.raw).toContain('"123"'); expect(plan.raw).toContain('"keep!"');
    expect(plan.raw).toContain('_资料/AI');
  });
  it('rejects traversal, hidden folders and invalid tags', () => {
    for (const folder of ['../outside', '/absolute', '.obsidian', 'a//b', 'C:/outside'])
      expect(() => normalizeFolderTags({ ...settings, rules: [{ folder, tags: ['tag'], recursive: true }] })).toThrow();
    expect(() => normalizeFolderTags({ ...settings, rules: [{ folder: 'a', tags: ['123'], recursive: true }] })).toThrow();
  });
  it('does not rewrite complex YAML', () => {
    expect(() => planFolderTags('---\ntags: &tags [a]\n---\n', '04资料/a.md', settings)).toThrow();
  });
});
