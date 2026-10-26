import { expect, it } from 'vitest';
import { analyzeMarkdown } from './syntax.js';
import { contentTargets, createContentTarget } from './contentTargets.js';
import { fragmentRange } from './fragments.js';
import { isGlobalContentTarget, parseLinkTarget, resolveTarget, TargetIndex } from './links.js';
import { extractMetadata } from './metadata.js';
import { equations } from './equations.js';
import { blockContainers } from './blocks.js';
import { footnotes } from './footnotes.js';

it('distinguishes global raw typed links and scoped legacy links, including aliases', () => {
  for (const namespace of ['heading', 'eq', 'code', 'callout', 'range']) {
    expect(isGlobalContentTarget(`^${namespace}-ID|alias`)).toBe(true);
    expect(parseLinkTarget(`^${namespace}-ID|alias`)).toEqual({ path: '', fragment: `^${namespace}-ID`, alias: 'alias' });
    expect(isGlobalContentTarget(`#^${namespace}-ID|alias`)).toBe(false);
  }
  for (const raw of ['^heading-', '^heading-a:b', '^heading-a/b', '^heading-bad_id']) {
    expect(isGlobalContentTarget(raw)).toBe(true);
    expect(parseLinkTarget(raw)).toEqual({ path: '', fragment: raw, alias: null });
    expect(fragmentRange(analyzeMarkdown('# Title'), raw)).toBeNull();
    expect(() => createContentTarget(analyzeMarkdown('# Title'), { from: 0, to: 0 }, 'heading', raw.slice(1))).toThrow();
  }
  for (const raw of ['note#^heading-ID', '#^heading-ID', '^ordinary']) expect(isGlobalContentTarget(raw)).toBe(false);
});

it('keeps heading identity through renaming and same-name sections', () => {
  for (const title of ['Same', 'Renamed']) {
    const model = analyzeMarkdown(`# ${title} ^heading-one\nbody\n\n# Same ^heading-two\nother`);
    const targets = contentTargets(model);
    expect(targets.targets.map(target => [target.id, target.label])).toEqual([['heading-one', title], ['heading-two', 'Same']]);
    expect(fragmentRange(model, '^heading-one')?.to).toBe(model.text.lastIndexOf('# Same'));
    expect(contentTargets(model)).toBe(targets);
  }
});

it('rejects typed mismatches and duplicates including ordinary equation IDs', () => {
  const model = analyzeMarkdown('# Heading ^code-wrong\n\nordinary ^heading-wrong\n\n$$x$$ ^eq-one\n\nordinary ^eq-one');
  expect(contentTargets(model).targets).toEqual([]);
  for (const id of ['code-wrong', 'heading-wrong', 'eq-one', 'range-missing', 'heading-']) expect(fragmentRange(model, '^' + id)).toBeNull();
  expect(contentTargets(model).issues.some(issue => issue.id === 'eq-one')).toBe(true);
});

it('attaches fenced code and callouts only to their own structural ends', () => {
  const model = analyzeMarkdown('```js\nx()\n```\n^code-one\n\n> [!note] Title\n> body ^callout-one\n\n```\nx\n```\n\n^code-distant');
  expect(contentTargets(model).targets.map(target => [target.id, target.kind])).toEqual([['code-one', 'code'], ['callout-one', 'callout']]);
  expect(contentTargets(model).targets.every(target => target.protectedSpans.length === 1)).toBe(true);
});

it('resolves a complete explicit block range without guessing an unclosed tail', () => {
  const model = analyzeMarkdown('^range-one:start\n\n# Title\n\nbody\n\n^range-one:end\n\n^range-open:start\n\ntail');
  const target = contentTargets(model).targets[0];
  expect(target?.id).toBe('range-one');
  expect(model.text.slice(target.from, target.to)).toBe('\n# Title\n\nbody\n\n');
  expect(target.protectedSpans).toHaveLength(2);
  expect(fragmentRange(model, '^range-open')).toBeNull();
});

it('rejects crossing, duplicated, partial and cross-container ranges', () => {
  for (const source of [
    '^range-a:start\n\na\n\n^range-b:start\n\nb\n\n^range-a:end\n\nc\n\n^range-b:end',
    '^range-a:start\n\na\n\n^range-a:start\n\nb\n\n^range-a:end',
    '^range-a:start\nparagraph\n^range-a:end',
    '> ^range-a:start\n>\n> body\n\n^range-a:end',
  ]) expect(contentTargets(analyzeMarkdown(source)).targets).toEqual([]);
});

it('ignores anchor-like source inside literals, comments, HTML, frontmatter and math', () => {
  const model = analyzeMarkdown('---\nid: ^heading-fm\n---\n\n```\n^range-code:start\n\nbody\n\n^range-code:end\n```\n\n%%\n^range-comment:start\n\nbody\n\n^range-comment:end\n%%\n\n<div>\n^range-html:start\nbody\n^range-html:end\n</div>\n\n$$\n^range-math:start\n\nbody\n\n^range-math:end\n$$\n\n`^heading-inline`');
  expect(contentTargets(model)).toEqual({ targets: [], issues: [] });
});

it('preserves legacy block IDs and refuses duplicate legacy IDs', () => {
  expect(fragmentRange(analyzeMarkdown('body ^legacy'), '^legacy')?.kind).toBe('block');
  expect(fragmentRange(analyzeMarkdown('body ^legacy\n\nother ^legacy'), '^legacy')).toBeNull();
});

it('creates validated source edits for each node kind and reuses existing owners', () => {
  for (const [source, kind, id] of [
    ['# Heading', 'heading', 'heading-created'],
    ['$$x$$', 'equation', 'eq-created'],
    ['```js\nx\n```', 'code', 'code-created'],
    ['> [!note] Title\n> body', 'callout', 'callout-created'],
    ['first\n\nsecond', 'range', 'range-created'],
  ] as const) {
    const model = analyzeMarkdown(source);
    const creation = createContentTarget(model, { from: 0, to: source.length }, kind, id);
    let next = source;
    for (const change of [...creation.changes].sort((left, right) => right.from - left.from)) next = next.slice(0, change.from) + change.insert + next.slice(change.to);
    const updated = analyzeMarkdown(next), target = contentTargets(updated).targets[0];
    expect(target?.id).toBe(id);
    expect(createContentTarget(updated, target.kind === 'range' ? target : target.focus, kind)).toEqual({ id, changes: [] });
  }
});

it('rejects invalid creation selections and conflicting IDs', () => {
  const model = analyzeMarkdown('# Heading\n\nbody ^heading-taken');
  expect(() => createContentTarget(model, { from: 0, to: 0 }, 'heading', 'heading-taken')).toThrow();
  expect(() => createContentTarget(model, { from: 1, to: 3 }, 'range', 'range-partial')).toThrow();
  expect(() => createContentTarget(model, { from: 0, to: 0 }, 'heading', 'code-wrong')).toThrow();
});

it('creates inline end IDs on ATX closing markers and Setext headings', () => {
  for (const source of ['# Heading ###', 'Heading\n=======']) {
    const model = analyzeMarkdown(source), created = createContentTarget(model, { from: 0, to: source.length }, 'heading', 'heading-one');
    const change = created.changes[0];
    const updated = analyzeMarkdown(source.slice(0, change.from) + change.insert + source.slice(change.to));
    expect(contentTargets(updated).targets[0].label).toBe('Heading');
  }
});

it('keeps nested range and quoted code ownership with protected markers', () => {
  const source = '> ^range-a:start\n>\n> first\n>\n> ^range-b:start\n>\n> second\n>\n> ^range-b:end\n>\n> ^range-a:end';
  expect(contentTargets(analyzeMarkdown(source)).targets.map(target => target.id)).toEqual(['range-a', 'range-b']);
  const code = analyzeMarkdown('> ```js\n> x\n> ```\n> ^code-one');
  expect(contentTargets(code).targets.map(target => target.id)).toEqual(['code-one']);
});

it('rejects an otherwise paired range with malformed extra boundaries', () => {
  expect(contentTargets(analyzeMarkdown('^range-a:start\n\nbody\n\n^range-a:end\n\n^range-a:wrong')).targets).toEqual([]);
});

it('preserves global versus local wiki destinations in shared metadata and excludes range boundary IDs', () => {
  const meta = extractMetadata(analyzeMarkdown('[[^heading-one|alias]] [[#^heading-one|local]] [[note#^heading-one]]\n\n^range-one:start\n\nbody\n\n^range-one:end'));
  expect(meta.links).toEqual(['^heading-one', '#^heading-one', 'note#^heading-one']);
  expect(meta.linkOccurrences.map(link => link.target)).toEqual(meta.links);
  expect(meta.blockIds).toEqual([]);
});

it('retains the existing equation ID alphabet', () => {
  const model = analyzeMarkdown('$$x$$ ^eq-a--');
  expect(fragmentRange(model, '^eq-a--')?.kind).toBe('equation');
});

function applyCreation(source: string, selection: { from: number; to: number }, kind: Parameters<typeof createContentTarget>[2], id: string) {
  const creation = createContentTarget(analyzeMarkdown(source), selection, kind, id);
  let text = source;
  for (const change of [...creation.changes].sort((left, right) => right.from - left.from)) text = text.slice(0, change.from) + change.insert + text.slice(change.to);
  return { creation, model: analyzeMarkdown(text) };
}

it('accepts heading anchors on either side of closing ATX hashes without treating prose as a heading', () => {
  for (const source of ['# Title ### ^heading-id', '# Title ^heading-id ###', '####### Title ^heading-id ###']) {
    const model = analyzeMarkdown(source), target = contentTargets(model).targets[0];
    expect(target?.id).toBe('heading-id');
    expect(target.label).toBe('Title');
    expect(model.text.slice(target.anchor!.from, target.anchor!.to)).toBe('^heading-id');
    expect(createContentTarget(model, target.focus, 'heading')).toEqual({ id: 'heading-id', changes: [] });
  }
  expect(extractMetadata(analyzeMarkdown('prose ^heading-id ###')).blockIds).toEqual([]);
  expect(contentTargets(analyzeMarkdown('# One ^heading-id ###\n\n# Two ### ^heading-id')).targets).toEqual([]);
});

it('bounds nested headings by their structural container and preserves document heading levels', () => {
  const source = '# Outer ^heading-outer\n\n> [!note] Callout\n> ## Inner ^heading-inner\n> body\n> ### Child\n> more\n> ## Peer ^heading-peer\n> tail\n\noutside\n\n## Child\n\n# Next';
  const model = analyzeMarkdown(source), targets = contentTargets(model).targets;
  expect(targets.find(target => target.id === 'heading-outer')?.to).toBe(source.lastIndexOf('# Next'));
  const inner = targets.find(target => target.id === 'heading-inner')!;
  expect(inner.to).toBe(source.indexOf('## Peer'));
  const peer = targets.find(target => target.id === 'heading-peer')!;
  expect(peer.to).toBe(source.indexOf('\n\noutside'));
  const selection = { from: source.indexOf('## Inner'), to: source.indexOf('## Inner') };
  expect(createContentTarget(model, selection)).toEqual({ id: 'heading-inner', changes: [] });
});

it('does not reclassify a callout title as a heading and defaults to the nearest nested owner', () => {
  const source = '> [!note] Outer\n> body\n> > [!tip] Inner\n> > inner body';
  const at = source.indexOf('inner body');
  const { model } = applyCreation(source, { from: at, to: at }, undefined, 'callout-inner');
  expect(contentTargets(model).targets.map(target => [target.id, target.kind, target.label])).toEqual([['callout-inner', 'callout', 'Inner']]);
  const title = source.indexOf('Outer');
  expect(() => createContentTarget(analyzeMarkdown(source), { from: title, to: title }, 'heading', 'heading-wrong')).toThrow();
});

it('accepts CM whole-line selections ending at the next line start and preserves following source', () => {
  const source = 'first\n\nsecond\n\nuntouched';
  const to = source.indexOf('\n\nuntouched') + 1;
  const { model, creation } = applyCreation(source, { from: 0, to }, 'range', 'range-lines');
  expect(contentTargets(model).targets[0]?.id).toBe('range-lines');
  expect(model.text.endsWith('\n\nuntouched')).toBe(true);
  expect(creation.changes.every(change => change.from === change.to)).toBe(true);
  const eof = applyCreation('one\n', { from: 0, to: 4 }, 'range', 'range-eof');
  expect(contentTargets(eof.model).targets[0]?.id).toBe('range-eof');
});

it('creates full nested-list and quote ranges without moving their structural declarations', () => {
  for (const source of ['- first\n- second\n', '> [!note] Keep Callout\n> body\n', '- outer\n  - inner\n  - sibling\n']) {
    const { model } = applyCreation(source, { from: 0, to: source.length }, 'range', 'range-container');
    const target = contentTargets(model).targets[0];
    expect(target?.id).toBe('range-container');
    expect(model.text.slice(target.from, target.to)).toContain(source.trimEnd());
    expect(model.nodes.filter(node => ['BulletList', 'ListItem', 'Blockquote'].includes(node.name)).map(node => node.name))
      .toEqual(analyzeMarkdown(source).nodes.filter(node => ['BulletList', 'ListItem', 'Blockquote'].includes(node.name)).map(node => node.name));
  }
});

it('creates range boundaries within one nested list item but rejects a partial list or mismatched quote depth', () => {
  const source = '- outer\n\n  first\n\n  second\n\n- next';
  const from = source.indexOf('  first'), to = source.indexOf('\n\n- next');
  const created = applyCreation(source, { from, to }, 'range', 'range-item');
  expect(contentTargets(created.model).targets[0]?.id).toBe('range-item');
  expect(() => createContentTarget(analyzeMarkdown('- first\n- second'), { from: 0, to: 7 }, 'range', 'range-partial')).toThrow();
  const invalid = '> ^range-depth:start\n>\n> > body\n> >\n> > ^range-depth:end';
  expect(contentTargets(analyzeMarkdown(invalid)).targets).toEqual([]);
});

it('retains unnumbered legacy equation anchors but rejects ambiguous and non-referenceable equations', () => {
  for (const tex of ['x\\notag', 'x{{}}', 'x\\nonumber']) {
    const target = contentTargets(analyzeMarkdown(`$$${tex}$$ ^eq-legacy`)).targets[0];
    expect(target?.kind).toBe('equation');
    expect(target.label).toBe(tex);
  }
  const duplicate = analyzeMarkdown('$$x$$ ^eq-duplicate\n\n$$y$$ ^eq-duplicate');
  expect(contentTargets(duplicate).targets).toEqual([]);
  expect(() => createContentTarget(duplicate, { from: 0, to: 0 }, 'equation')).toThrow();
  const table = analyzeMarkdown('| Formula |\n| --- |\n| $$x$$ ^eq-table');
  expect(equations(table)[0]).toMatchObject({ id: 'eq-table', referenceable: false });
  expect(contentTargets(table).targets).toEqual([]);
  expect(contentTargets(table).issues.some(issue => issue.id === 'eq-table')).toBe(true);
});

it('exposes complete absolute anchor token spans for marker hiding and clipboard protection', () => {
  const model = analyzeMarkdown('> ^range-one:start\n>\n> # Title ^heading-title ###\n>\n> body\n>\n> ^range-one:end');
  const targets = contentTargets(model).targets;
  expect(targets.flatMap(target => target.protectedSpans).map(span => model.text.slice(span.from, span.to))).toEqual(['^range-one:start', '^range-one:end', '^heading-title']);
});

it('does not capture prose preceding an existing display equation anchor', () => {
  const model = analyzeMarkdown('prose $$x$$ ^eq-one');
  const target = contentTargets(model).targets[0];
  expect(model.text.slice(target.from, target.to)).toBe('$$x$$ ^eq-one');
});

it('preserves legacy heading links and outline labels when adding stable identity', () => {
  for (const source of ['# Title', '# Title ###', 'Title\n=====','####### Title']) {
    const { model } = applyCreation(source, { from: 0, to: source.length }, 'heading', 'heading-stable');
    expect(extractMetadata(model).headings[0].text).toBe('Title');
    expect(contentTargets(model).targets[0].label).toBe('Title');
    expect(fragmentRange(model, 'Title')).toMatchObject({ kind: 'heading', from: 0 });
    expect(extractMetadata(model).headings[0].to).toBe(model.text.length);
  }
  for (const source of ['# Title ^heading-stable ###', '# Title ### ^heading-stable']) {
    const model = analyzeMarkdown(source);
    expect(fragmentRange(model, 'Title')).not.toBeNull();
    expect(extractMetadata(model).headings[0].text).toBe('Title');
  }
  expect(extractMetadata(analyzeMarkdown('# Title ### ###')).headings[0].text).toBe('Title ###');
});

it('anchors the selected parent Callout instead of its last nested child', () => {
  for (const source of [
    '> [!note] Parent\n> body\n> > [!tip] Child\n> > child body',
    '> [!note] Parent\n> > [!tip] Child\n> > child body ^callout-child\n\nuntouched',
    '> [!note] Outer\n> > [!warning] Parent\n> > > [!tip] Child\n> > > child body',
    '> [!note] Parent\n> ```js\n> const child = true;\n> ```',
  ]) {
    const before = analyzeMarkdown(source), selected = blockContainers(before).find(block => block.title === 'Parent')!;
    const at = source.indexOf('Parent');
    const { model, creation } = applyCreation(source, { from: at, to: at }, 'callout', 'callout-parent');
    const targets = contentTargets(model).targets, target = targets.find(target => target.id === 'callout-parent')!;
    expect(target.focus.from).toBe(selected.from);
    expect(target.focus.to).toBe(selected.to + creation.changes.reduce((length, change) => length + change.insert.length, 0));
    expect(blockContainers(model).find(block => block.title === 'Parent')?.to).toBe(target.focus.to);
    expect(target.label).toBe('Parent');
    expect(model.text.slice(target.focus.from, target.focus.to)).toContain('child');
    expect(model.text.slice(target.anchor!.from, target.anchor!.to)).toBe('^callout-parent');
    expect(createContentTarget(model, { from: at, to: at }, 'callout')).toEqual({ id: 'callout-parent', changes: [] });
    if (source.includes('^callout-child')) {
      expect(targets.find(target => target.id === 'callout-child')?.label).toBe('Child');
      expect(model.text.endsWith('\n\nuntouched')).toBe(true);
    }
  }
});

it('never resolves global typed references through file-only resolvers', () => {
  const files = ['source.md', '^heading-one.md', 'folder/target.md'];
  const index = new TargetIndex(files);
  for (const raw of ['^heading-one', '^eq-one|alias', '^code-one', '^callout-one', '^range-one', '^heading-', '^heading-bad_id']) {
    const expected = { ...parseLinkTarget(raw), status: 'missing', candidates: [] };
    expect(resolveTarget(raw, 'source.md', files)).toEqual(expected);
    expect(index.resolve(raw, 'source.md')).toEqual(expected);
    expect(index.dependencies(raw, 'source.md')).toEqual([]);
  }
  for (const raw of ['#Title', '#^heading-one', '#^legacy']) {
    expect(resolveTarget(raw, 'source.md', files)).toMatchObject({ path: 'source.md', status: 'resolved' });
    expect(index.resolve(raw, 'source.md')).toMatchObject({ path: 'source.md', status: 'resolved' });
  }
});

it('never interprets global wiki links or embeds as footnotes while preserving true footnotes', () => {
  const source = ['heading', 'eq', 'code', 'callout', 'range'].map(kind => `[[^${kind}-stable]] ![[^${kind}-stable]] [[^${kind}-stable|alias [^fake]]]`).join('\n\n');
  const model = analyzeMarkdown(source);
  expect(footnotes(model).notes).toEqual([]);
  expect(footnotes(model).references.size).toBe(0);
  expect(footnotes(model).definitions.size).toBe(0);
  expect(analyzeMarkdown('[[^heading-stable]] ![[^heading-stable]]').nodes.some(node => node.name === 'FootnoteReference')).toBe(false);
  const mixed = footnotes(analyzeMarkdown(source + '\n\nreal[^real] and ^[inline body]\n\n[^real]: genuine definition'));
  expect(mixed.notes.map(note => [note.id, note.status, note.inline])).toEqual([
    ['real', 'resolved', false], [expect.any(String), 'resolved', true],
  ]);
  expect(mixed.references.size).toBe(2);
});
