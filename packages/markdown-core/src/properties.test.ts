import { expect, it } from 'vitest';
import { patchPropertyRows, readPropertyRows } from './properties.js';
import { SourceDocument } from './source.js';

it('edits one YAML value without rewriting quotes, comments or unknown structures', () => {
  const yaml = "# keep\ntitle: 'old' # inline\nuntouched: \"quoted\"\ncomplex:\n  nested: [1, 2]\n";
  const rows = readPropertyRows(yaml);
  rows[0].values = ['new'];
  const doc = new SourceDocument(yaml);
  doc.apply(patchPropertyRows(yaml, rows));
  expect(doc.raw).toBe(yaml.replace("'old'", "'new'"));
});

it('edits and appends list items while preserving existing list spelling', () => {
  for (const yaml of ["tags: ['one', \"two\"] # keep\nother: yes\n", "tags:\n  - 'one' # keep\n  - \"two\"\nother: yes\n"]) {
    const rows = readPropertyRows(yaml);
    rows[0].values[1] = 'TWO';
    let doc = new SourceDocument(yaml);
    doc.apply(patchPropertyRows(yaml, rows));
    expect(doc.raw).toBe(yaml.replace('two', 'TWO'));
    const next = readPropertyRows(doc.raw);
    next[0].values.push('three');
    const before = doc.raw;
    doc.apply(patchPropertyRows(before, next));
    expect(readPropertyRows(doc.raw)[0].values).toEqual(['one', 'TWO', 'three']);
    expect(doc.raw).toContain("'one'");
    expect(doc.raw).toContain('"TWO"');
    expect(doc.raw).toContain('# keep');
    expect(doc.raw).toContain('other: yes\n');
  }
});

it('rejects duplicate keys and refuses to edit complex values through a scalar control', () => {
  expect(() => patchPropertyRows('a: 1\na: 2', [])).toThrow();
  const yaml = 'complex:\n  nested: value\n';
  const rows = readPropertyRows(yaml);
  expect(rows[0].editable).toBe(false);
  rows[0].values = ['overwrite'];
  expect(() => patchPropertyRows(yaml, rows)).toThrow();
});

it('retains empty-list semantics and supports local rename/add/delete edits', () => {
  const yaml = "# keep\ntags:\n  - 'one'\n  - two\nname: \"value\" # inline\nother: yes\n";
  let doc = new SourceDocument(yaml);
  const rows = readPropertyRows(yaml);
  rows[0].values = [];
  rows[1].key = 'renamed';
  rows.push({ key: 'new', values: ['text'], list: false });
  doc.apply(patchPropertyRows(yaml, rows));
  expect(readPropertyRows(doc.raw).find((row) => row.key === 'tags')?.values).toEqual([]);
  expect(doc.raw).toContain('renamed: "value" # inline\nother: yes\n');
  const next = readPropertyRows(doc.raw).filter((row) => row.key !== 'renamed');
  const before = doc.raw;
  doc.apply(patchPropertyRows(before, next));
  expect(doc.raw).toContain('# keep\n');
  expect(doc.raw).toContain('other: yes\n');
  expect(doc.raw).not.toContain('renamed');
});
