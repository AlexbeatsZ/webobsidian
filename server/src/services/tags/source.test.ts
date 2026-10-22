import { describe, expect, it } from 'vitest';
import { SourceDocument, DocumentSession } from '@webobsidian/markdown-core';
import { planTagSource, transformTag, validateCapturedTagChanges } from './source.js';
import { matchesTagFilters, normalizeStoredTags, parseTagFilters, tagPageAliases, withTagFilter } from './query.js';
import { readTagSourceNames } from './values.js';

// Prepared regression source only. Do not execute while static-only acceptance
// applies; these cases do not read or modify any actual Vault.
describe('native tag source preservation', () => {
  it('renames mixed-case target properties and inline hierarchy without touching unrelated bytes', () => {
    const raw = '\ufeff' + [
      '---', '# preserve YAML comment', 'tags: [Foo/Sub, keep] # inline comment',
      'aliases: []', 'Aliases: ["#foo/Sub", "ordinary alias"]',
      'custom: >-', '  untouched  text', '---', '#FOO/Sub and #foo-other', '',
    ].join('\r\n');
    const result = planTagSource(raw, { kind: 'rename', from: 'foo', to: 'science/physics' });
    expect(result.raw).toBe('\ufeff' + [
      '---', '# preserve YAML comment', 'tags: [science/physics/Sub, keep] # inline comment',
      'aliases: []', 'Aliases: ["#science/physics/Sub", "ordinary alias"]',
      'custom: >-', '  untouched  text', '---', '#science/physics/Sub and #foo-other', '',
    ].join('\r\n'));
  });
  it('keeps code, formula, HTML, links, wikilinks and comments literal', () => {
    const raw = '#old\n`#old`\n$#old$\n%% #old %%\n[[note #old]]\n[label #old](note)\n<!-- #old -->\n```md\n#old\n```\n';
    expect(planTagSource(raw, { kind: 'rename', from: 'old', to: 'new' }).raw).toBe(raw.replace(/^#old/, '#new'));
  });
  it('normalizes scalar/array/Set without spreading strings into letters', () => {
    expect(normalizeStoredTags('physics')).toEqual(['physics']);
    expect(normalizeStoredTags(['physics', 'chemistry/topic'])).toEqual(['physics', 'chemistry/topic']);
    expect(normalizeStoredTags(new Set(['physics', '#chemistry']))).toEqual(['physics', 'chemistry']);
    const raw = '---\nTags: physics # keep\ncustom:  42\n---\nbody';
    const result = planTagSource(raw, { kind: 'add', tags: ['physics', 'chemistry'] });
    expect(result.raw).toContain('Tags: [physics, chemistry] # keep\ncustom:  42');
  });
  it('patches list removal and refuses any removal span that consumes a comment', () => {
    const raw = '---\ntags: [old, keep]\n---\n#old #keep';
    const result = planTagSource(raw, { kind: 'remove', tags: ['old'] });
    expect(readTagSourceNames(result.raw)).toEqual(['keep']);
    expect(result.raw.endsWith(' #keep')).toBe(true);
    expect(() => planTagSource('---\ntags:\n  - old # keep comment\n  - keep\n---\n#old', { kind: 'remove', tags: ['old'] }))
      .toThrow(/comment/);
  });
  it.each([
    '---\ntags: [old\n---\n#old',
    '---\ntags: &base [old]\nother: *base\n---\n#old',
    '---\ntags: *base\n---\n#old',
    '---\n<<: *base\n---\n#old',
    '---\ntags: old\ntags: keep\n---\n#old',
    '---\ntags: |-\n  old\n---\n#old',
  ])('fails the entire file for unsafe YAML without returning partial inline edits', (raw) => {
    expect(() => planTagSource(raw, { kind: 'rename', from: 'old', to: 'new' })).toThrow();
  });
  it('preserves mixed line endings, BOM and missing final newline through exact inverse edits', () => {
    const raw = '\ufeff---\r\ntags: [old, keep]\n---\r\n#old';
    const plan = planTagSource(raw, { kind: 'rename', from: 'old', to: 'new' });
    const document = new SourceDocument(raw), inverse = document.apply(plan.changes);
    expect(document.raw).toBe(plan.raw);
    document.apply(inverse);
    expect(document.raw).toBe(raw);
  });
  it('preserves descendant suffix spelling across Unicode normalization', () => {
    expect(transformTag('#Cafe\u0301/Child', { kind: 'rename', from: 'café', to: 'science' })).toBe('#science/Child');
  });
  it('rejects captured positions changed after preview', () => {
    const plan = planTagSource('#old', { kind: 'rename', from: 'old', to: 'new' });
    expect(() => validateCapturedTagChanges('#old', plan.changes, plan.expected)).not.toThrow();
    expect(() => validateCapturedTagChanges('#other', plan.changes, plan.expected)).toThrow(/positions/);
  });
  it('uses one document-session history step and awaits saved content', async () => {
    const writes: string[] = [];
    const session = new DocumentSession('fixture.md', '#old', 'r1', async (_path, raw) => {
      writes.push(raw); return { revision: 'r2' };
    });
    session.edit(session.snapshot.version, [{ from: 4, to: 4, insert: ' unsaved' }], 'fixture');
    const before = session.snapshot.raw;
    const plan = planTagSource(before, { kind: 'rename', from: 'old', to: 'new' }, session.analysis);
    session.edit(session.snapshot.version, plan.changes, 'tags.rename');
    await session.save();
    expect(writes).toEqual(['#new unsaved']);
    session.undo(); expect(session.snapshot.raw).toBe(before);
  });
});

describe('native tag query and page aliases', () => {
  it('ANDs include filters and excludes hierarchies case-insensitively', () => {
    const filters = parseTagFilters('formula tag:#Science -tag:#Science/old tag:课程');
    expect(filters.text).toBe('formula');
    expect(matchesTagFilters(['SCIENCE/physics', '课程/笔记'], filters)).toBe(true);
    expect(matchesTagFilters(['SCIENCE/old/topic', '课程'], filters)).toBe(false);
    expect(matchesTagFilters(['science-other', '课程'], filters)).toBe(false);
    expect(withTagFilter('formula -tag:#science', 'Science', 'include')).toBe('formula tag:#Science');
  });
  it('indexes both alias case variants even when the first key is empty', () => {
    expect(readTagSourceNames('---\naliases: []\nAliases: ["#150化学", ordinary]\n---\n')).toEqual(['150化学']);
    expect(tagPageAliases('ordinary alias, #Physics/Sub')).toEqual(['Physics/Sub']);
  });
});
