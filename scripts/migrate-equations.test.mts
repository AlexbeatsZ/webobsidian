import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { planMigration, main } from './migrate-equations.mts';
import { analyzeMarkdown, equationContext, equationTarget } from '../packages/markdown-core/src/index.ts';

const plan = (source: string, options = {}) => planMigration(new Map([['a.md', source]]), options);
test('migrates raw number references, links, embeds, percent fragments; second run is empty', () => {
  const source = '# A\n$$x \\tag{9-8}$$\n由$\\text{(9-8)}$与[[#=(9-8)]]、![[#=(9-8)|原式]]和[[#%3D%289-8%29]]可得';
  const result = plan(source), after = result.entries[0].after;
  assert.equal(result.issues.length, 0);
  assert.equal(result.summary.referencesConverted, 4);
  assert.ok(!after.includes('\\tag'));
  assert.ok(after.includes('![[#^eq-migrated1|原式]]'));
  assert.deepEqual(result.numbered[0], { file: 'a.md', id: 'eq-migrated1', old: '9-8', current: '1-1' });
  assert.equal(plan(after).entries.length, 0);
});
test('keeps aliases by default; removes only matching numeric aliases when requested', () => {
  const source = '$$x \\tag{1-1}$$\n[[#=(1-1)|$\\text{(1-1)}$]] [[#=(1-1)|手写]]';
  assert.ok(plan(source).entries[0].after.includes('|$\\text{(1-1)}$]]'));
  const after = plan(source, { dropNumberAliases: true }).entries[0].after;
  assert.ok(after.includes('[[#^eq-migrated1]] [[#^eq-migrated1|手写]]'));
});
test('single numbers, decimal numbers and Unicode hyphens migrate without changing their targets', () => {
  const result = plan('$$x \\tag*{3}$$\n$$y \\tag{2.5}$$\n$$z \\tag{4–7}$$\n$\\text{(3)}$ $\\text{(2.5)}$ $\\text{(4-7)}$');
  assert.equal(result.summary.referencesConverted, 3); assert.equal(result.summary.tagsRemoved, 3);
  assert.equal(result.issues.length, 0);
});
test('does not strip commands from macro definitions or commented TeX', () => {
  const macro = plan('$$\\newcommand{\\x}{\\tag{1-1}}x$$');
  assert.equal(macro.summary.tagsRemoved, 0); assert.equal(macro.issues.length, 1);
  const comment = plan('$$x % \\tag{1-1}\ny$$');
  assert.equal(comment.summary.tagsRemoved, 0); assert.equal(comment.issues.length, 1);
});
test('preserves BOM, CRLF, unrelated whitespace, fenced code, YAML, inline code and comments', () => {
  const source = '\ufeff---\r\nvalue: "[[#=(1-1)]]"\r\n---\r\n# A\r\n$$x \\tag{1-1}$$\r\n  原文  \r\n```md\r\n$$fake \\tag{7-1}$$\r\n[[#=(1-1)]]\r\n```\r\n`[[#=(1-1)]]`\r\n%% [[#=(1-1)]] %%\r\n<!-- $\\text{(1-1)}$ -->\r\n由$\\text{(1-1)}$得\r\n';
  const result = plan(source), after = result.entries[0].after;
  const expected = source.replace('$$x \\tag{1-1}$$', () => '$$x $$ ^eq-migrated1').replace('由$\\text{(1-1)}$得', '由[[#^eq-migrated1]]得');
  assert.equal(after, expected); assert.equal(result.issues.length, 0);
});
test('keeps custom tags, unnumbered math, table math, ordinary blocks, code and TeX meaning', () => {
  const source = '$$\\ce{A ->[$k_+$][$k_-$] B} \\tag{named}$$\n[[#=(named)]]\n$$skip \\notag$$\n| A |\n|---|\n| $$t$$ |\n';
  const result = plan(source);
  assert.equal(result.summary.tagsRemoved, 0);
  assert.ok(result.entries[0].after.includes('\\tag{named}'));
  assert.ok(result.entries[0].after.includes('$$skip \\notag$$'));
  assert.ok(result.entries[0].after.includes('| $$t$$ |'));
  assert.equal(plan('$$already native$$\nno changes').entries.length, 0);
  assert.equal(plan('$$already native$$ trailing text').issues.length, 0);
  assert.ok(plan('$$x \\notag \\tag{1-1}$$\n[[#=(1-1)]]').entries[0].after.includes('\\tag{1-1}'));
});
test('preserves and reuses an existing anchor, handles generated ID collisions', () => {
  const source = 'paragraph ^eq-migrated1\n\n$$x \\tag{1-1}$$\n$$y \\tag{1-2}$$ ^eq-migrated1-1\n[[#=(1-1)]] [[#=(1-2)]]';
  const result = plan(source);
  assert.equal(result.issues.length, 0);
  assert.ok(result.entries[0].after.includes('$$x $$ ^eq-migrated1-2'));
  assert.ok(result.entries[0].after.includes('[[#^eq-migrated1-1]]'));
  const renamed = plan('$$x$$ ^old\n[[#^old|]]\n[old](#^old)\n');
  assert.equal(renamed.summary.anchorsRenamed, 1);
  assert.ok(renamed.entries[0].after.includes('$$x$$ ^eq-old'));
  assert.ok(renamed.entries[0].after.includes('[[#^eq-old|]]'));
  assert.ok(renamed.entries[0].after.includes('[old](#^eq-old)'));
  assert.equal(plan(renamed.entries[0].after).entries.length, 0);
});
test('duplicate tags require an occurrence; unresolved references are retained and reported', () => {
  const source = '$$x \\tag{1-1}$$\n$$y \\tag{1-1}$$\n[[#=(1-1)§2]] [[#=(1-1)]] $\\text{(8-8)}$';
  const result = plan(source);
  assert.equal(result.issues.length, 2);
  assert.equal(result.summary.tagsRemoved, 0);
  assert.ok(result.entries[0].after.includes('[[#^eq-migrated2]] [[#=(1-1)]] $\\text{(8-8)}$'));
});
test('quotes/callouts use original segments and source offsets', () => {
  const source = '> [!note]\n> $$\n> x \\tag{4-2}\n> $$\n> 由$\\text{(4-2)}$得\n';
  const result = plan(source), after = result.entries[0].after;
  assert.equal(result.issues.length, 0);
  assert.ok(after.includes('> $$ ^eq-migrated1\n> 由[[#^eq-migrated1]]得'));
  const eq = equationTarget(equationContext(analyzeMarkdown(after)), '^eq-migrated1');
  assert.equal(eq?.number, '1-1'); assert.ok(!eq?.tex.includes('>'));
});
test('single-file selection updates inbound cross-file references and preserves unrelated target tags', () => {
  const source = new Map([
    ['folder/a.md', '$$x \\tag{8-1}$$\n'],
    ['folder/b.md', '$$y \\tag{2-1}$$\n[[a#=(8-1)|named]] ![[a#=(8-1)]]'],
  ]);
  const result = planMigration(source, { files: ['folder/a.md'] });
  assert.equal(result.issues.length, 0); assert.equal(result.entries.length, 2);
  assert.ok(result.entries.find(e => e.file.endsWith('b.md'))!.after.includes('\\tag{2-1}'));
  assert.ok(result.entries.find(e => e.file.endsWith('b.md'))!.after.includes('![[a#^eq-migrated1]]'));
});
test('Markdown destinations and reference definitions reuse parser URL spans', () => {
  const result = plan('$$x \\tag{1-1}$$\n[式](#=(1-1) "title")\n[ref][eq]\n\n[eq]: #=(1-1)\n');
  assert.equal(result.issues.length, 0);
  assert.equal(result.summary.referencesConverted, 2);
  assert.ok(result.entries[0].after.includes('[式](#^eq-migrated1 "title")'));
  assert.ok(result.entries[0].after.includes('[eq]: #^eq-migrated1'));
});
test('formula references in tables preserve the escaped alias separator', () => {
  const result = plan('$$x \\tag{1-1}$$\n\n| A |\n|---|\n| [[#=(1-1)\\|自定义]] |\n');
  assert.equal(result.issues.length, 0); assert.equal(result.summary.referencesConverted, 1);
  assert.ok(result.entries[0].after.includes('[[#^eq-migrated1\\|自定义]]'));
});
test('ambiguous files, duplicate IDs and out-of-selection targets never guess', () => {
  const result = planMigration(new Map([
    ['a.md', '$$x \\tag{1-1}$$ ^same\nother ^same\n[[b#=(1-1)]]'],
    ['one/b.md', '$$b \\tag{1-1}$$'], ['two/b.md', '$$c \\tag{1-1}$$'],
  ]));
  assert.equal(result.issues.length, 2);
  assert.ok(result.entries.every(e => e.file !== 'a.md'));
  const out = planMigration(new Map([['a.md', '[[b#=(1-1)]]'], ['b.md', '$$x \\tag{1-1}$$']]), { files: ['a.md'] });
  assert.equal(out.issues.length, 1); assert.equal(out.entries.length, 0);
});
test('apply/restore are exact; refuses unresolved writes, overwrite, invalid UTF-8 and changed originals', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '.agents', 'equation-migration-'));
  const vault = path.join(root, 'vault'), out = path.join(root, 'preview');
  await fs.mkdir(vault); const file = path.join(vault, 'a.md');
  const before = '\ufeff# A\r\n$$x \\tag{9-8}$$\r\n由$\\text{(9-8)}$得\r\n';
  try {
    await fs.writeFile(file, before);
    await assert.rejects(main(['--vault', vault, '--out', path.join(vault, 'new/sub/output')]), /outside the source vault/);
    await assert.rejects(fs.stat(path.join(vault, 'new')), /ENOENT/);
    await main(['--vault', vault, '--out', out, '--apply']);
    const after = await fs.readFile(file, 'utf8'); assert.notEqual(after, before);
    assert.equal(await fs.readFile(path.join(out, 'before/a.md'), 'utf8'), before);
    await assert.rejects(main(['--vault', vault, '--out', out]), /EEXIST/);
    await fs.appendFile(file, 'new edit');
    await assert.rejects(main(['--restore', out]), /edited since migration/);
    assert.equal(await fs.readFile(file, 'utf8'), after + 'new edit');
    await fs.writeFile(file, after);
    await main(['--restore', out]); assert.equal(await fs.readFile(file, 'utf8'), before);
    await main(['--restore', out]); assert.equal(await fs.readFile(file, 'utf8'), before);
    await fs.writeFile(file, before + '\n[[#=(missing)]]');
    await assert.rejects(main(['--vault', vault, '--out', path.join(root, 'blocked'), '--apply']), /unresolved issues/);
    assert.equal(await fs.readFile(file, 'utf8'), before + '\n[[#=(missing)]]');
    await fs.writeFile(file, Buffer.from([0xff]));
    await assert.rejects(main(['--vault', vault, '--out', path.join(root, 'invalid')]), /encoded data/);
  } finally {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir(), '.agents'));
    assert.ok(path.basename(root).startsWith('equation-migration-'));
    await fs.rm(root, { recursive: true, force: true });
  }
});
