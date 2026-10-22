import { describe, expect, it } from 'vitest';
import { analyzeMarkdown, DocumentSession, SourceDocument } from '@webobsidian/markdown-core';
import { planHeadingLevels } from './headingLevels';

// Prepared regression source only; do not execute under the static-only boundary.
describe('native heading level plans', () => {
  it('shifts the whole selection by one without serializing source', () => {
    const source = '##  parent ###\ntext\n####\tchild\n';
    const plan = planHeadingLevels(analyzeMarkdown(source), { from: 0, to: source.length }, 'promote');
    const result = new SourceDocument(source); result.apply(plan.changes);
    expect(result.raw).toBe('#  parent ###\ntext\n###\tchild\n');
    expect(plan.count).toBe(2);
  });
  it.each(['promote', 'demote'] as const)('blocks the whole group at the %s bound', direction => {
    const source = direction === 'promote' ? '## child\n# parent' : '## parent\n###### child';
    const plan = planHeadingLevels(analyzeMarkdown(source), { from: 0, to: source.length }, direction);
    expect(plan.status).toBe('at-limit'); expect(plan.changes).toEqual([]);
  });
  it('uses only the cursor line without a selection', () => {
    const source = '## first\n### second\n';
    const at = source.indexOf('second');
    const plan = planHeadingLevels(analyzeMarkdown(source), { from: at, to: at }, 'demote');
    const result = new SourceDocument(source); result.apply(plan.changes);
    expect(result.raw).toBe('## first\n#### second\n');
  });
  it('excludes code, YAML, comments, formulas, setext and seven-hash body titles', () => {
    const source = ['---', 'value: |', '  # yaml', '---', '```md', '# code', '```', '%%', '# comment', '%%',
      '$$', '# formula', '$$', 'Setext', '======', '####### body', '## real'].join('\n');
    const plan = planHeadingLevels(analyzeMarkdown(source), { from: 0, to: source.length }, 'demote');
    expect(plan.status).toBe('ready'); expect(plan.count).toBe(1);
    const result = new SourceDocument(source); result.apply(plan.changes);
    expect(result.raw).toBe(source.replace('## real', '### real'));
  });
  it('leaves a partially selected marker and the next unselected line intact', () => {
    const source = '### first\n## second\n### third';
    const plan = planHeadingLevels(analyzeMarkdown(source), { from: 1, to: source.indexOf('### third') }, 'demote');
    const result = new SourceDocument(source); result.apply(plan.changes);
    expect(result.raw).toBe('### first\n### second\n### third');
  });
  it('retains BOM and mixed line endings, with one shared undo group', () => {
    const raw = '\ufeff##  first\r\n\r\n###\tsecond\n';
    const session = new DocumentSession('a.md', raw, 'old', async () => ({ revision: 'new' }));
    const plan = planHeadingLevels(session.analysis, { from: 0, to: session.snapshot.text.length }, 'demote');
    session.edit(session.snapshot.version, plan.changes, 'headings.demote');
    expect(session.snapshot.raw).toBe('\ufeff###  first\r\n\r\n####\tsecond\n');
    session.undo(); expect(session.snapshot.raw).toBe(raw);
  });
});
