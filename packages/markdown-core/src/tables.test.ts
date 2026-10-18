import { expect, it } from 'vitest';
import { analyzeMarkdown } from './syntax.js';
import { tableModels, editTableCell, changeTable } from './tables.js';
import { SourceDocument } from './source.js';

it('patches one cell without changing pipes, alignment, escaping or line endings', () => {
  const raw = '\ufeff| **A**  | B |\r\n| :--- | ---: |\n| x\\|y | `z` |\r\n';
  const doc = new SourceDocument(raw);
  const table = tableModels(analyzeMarkdown(doc.text))[0];
  doc.apply([editTableCell(table, 1, 1, '**new**')]);
  expect(doc.raw).toBe(raw.replace('`z`', '**new**'));
  expect(table.rows[1].cells[0].text).toBe('x\\|y');
});

it('structural edits preserve untouched cell tokens and nested quote prefixes', () => {
  const text = '> | a  | b |\n> | :--- | ---: |\n> | c | d |\n\nend';
  const doc = new SourceDocument(text);
  let table = tableModels(analyzeMarkdown(doc.text))[0];
  doc.apply(changeTable(table, { kind: 'align', column: 1, align: 'center' }));
  expect(doc.raw).toBe(text.replace('---:', ':---:'));
  table = tableModels(analyzeMarkdown(doc.text))[0];
  doc.apply(changeTable(table, { kind: 'insertRow', row: 1 }));
  expect(doc.raw).toContain('> | c | d |\n> |  |  |\n\nend');
  expect(doc.raw).toContain('> | a  | b |');
});

it('does not find tables inside code and rejects malformed cell editing', () => {
  expect(tableModels(analyzeMarkdown('```\n| a | b |\n| --- | --- |\n```'))).toEqual([]);
  const table = tableModels(analyzeMarkdown('| a | b |\n| --- | --- |\n| only |'))[0];
  expect(table.editable).toBe(false);
  expect(() => editTableCell(table, 1, 1, 'new')).toThrow();
});

it('moves rows/columns and inserts/deletes columns using local token patches', () => {
  const original = '| a  | b |\n| :--- | ---: |\n| c | d |\n| e | f |';
  const doc = new SourceDocument(original);
  const mutate = (operation: Parameters<typeof changeTable>[1]) => doc.apply(changeTable(tableModels(analyzeMarkdown(doc.text))[0], operation));
  mutate({ kind: 'moveColumn', column: 0, to: 1 });
  expect(doc.raw).toBe('| b  | a |\n| ---: | :--- |\n| d | c |\n| f | e |');
  mutate({ kind: 'moveRow', row: 0, to: 1 });
  expect(doc.raw).toContain('| f | e |\n| d | c |');
  mutate({ kind: 'insertColumn', column: 1 });
  expect(tableModels(analyzeMarkdown(doc.text))[0].align).toHaveLength(3);
  mutate({ kind: 'deleteColumn', column: 1 });
  expect(doc.raw).toBe('| b  | a |\n| ---: | :--- |\n| f | e |\n| d | c |');
});
