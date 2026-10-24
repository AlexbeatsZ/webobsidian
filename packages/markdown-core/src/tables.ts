import type { MarkdownModel, SourceSpan } from './syntax.js';
import type { SourceChange } from './source.js';
import { sourceLinePrefix } from './blocks.js';

export interface TableCell extends SourceSpan { text: string; slotFrom: number; slotTo: number }
export interface TableRow extends SourceSpan { text: string; prefix: string; cells: TableCell[] }
export interface TableModel extends SourceSpan {
  key: string; rows: TableRow[]; delimiter: TableRow;
  align: ('left' | 'right' | 'center' | null)[]; editable: boolean;
}

function row(text: string, from: number, to: number): TableRow {
  const value = text.slice(from, to);
  const prefix = sourceLinePrefix(value);
  const start = from + prefix.length;
  const pipes: number[] = [];
  for (let p = start; p < to; p++) if (text[p] === '|') {
    let escapes = 0;
    for (let k = p - 1; k >= start && text[k] === '\\'; k--) escapes++;
    if (escapes % 2 === 0) pipes.push(p);
  }
  const bounds = [start - 1, ...pipes, to];
  if (pipes[0] === start) bounds.shift();
  if (pipes.at(-1) === to - 1 || (pipes.length && !text.slice(pipes.at(-1)! + 1, to).trim())) bounds.pop();
  const cells: TableCell[] = [];
  for (let i = 1; i < bounds.length; i++) {
    const slotFrom = bounds[i - 1] + 1, slotTo = bounds[i];
    let a = slotFrom, b = slotTo;
    while (a < b && /[ \t]/.test(text[a])) a++;
    while (b > a && /[ \t]/.test(text[b - 1])) b--;
    cells.push({ from: a, to: b, text: text.slice(a, b), slotFrom, slotTo });
  }
  return { from, to, text: value, prefix, cells };
}

const tablesByModel=new WeakMap<MarkdownModel,TableModel[]>();
export function tableModels(model: MarkdownModel): TableModel[] {
  const existing=tablesByModel.get(model);if(existing)return existing;
  const tables=model.nodes.filter(n => n.name === 'Table' && !(model.frontmatter && n.from < model.frontmatter.to)).map(n => {
    const from = model.text.lastIndexOf('\n', n.from - 1) + 1;
    const lines: TableRow[] = [];
    let p = from;
    while (p <= n.to) {
      const end = Math.min(model.text.indexOf('\n', p) < 0 ? model.text.length : model.text.indexOf('\n', p), n.to);
      lines.push(row(model.text, p, end)); p = end + 1;
    }
    const delimiter = lines.splice(1, 1)[0];
    const count = lines[0].cells.length;
    const align = delimiter.cells.map(c => c.text.startsWith(':') ? c.text.endsWith(':') ? 'center' as const : 'left' as const : c.text.endsWith(':') ? 'right' as const : null);
    return { from, to: n.to, key: model.text.slice(from, n.to), rows: lines, delimiter, align,
      editable: count > 0 && delimiter.cells.length === count && lines.every(r => r.cells.length === count) };
  });
  tablesByModel.set(model,tables);return tables;
}

export function editTableCell(table: TableModel, rowIndex: number, column: number, value: string): SourceChange {
  const cell = table.rows[rowIndex]?.cells[column];
  if (!table.editable || !cell) throw new Error('Edit irregular tables in source mode');
  // Escape only new unescaped delimiters; existing Markdown and escaped pipes stay intact.
  const insert = value.replace(/(^|[^\\])((?:\\\\)*)\|/g, '$1$2\\|').replace(/\r\n|\r|\n/g, '<br>');
  return { from: cell.from, to: cell.to, insert };
}

export type TableOperation =
  | { kind: 'align'; column: number; align: 'left' | 'right' | 'center' }
  | { kind: 'insertRow'; row: number } | { kind: 'deleteRow'; row: number }
  | { kind: 'insertColumn'; column: number } | { kind: 'deleteColumn'; column: number }
  | { kind: 'moveRow'; row: number; to: number } | { kind: 'moveColumn'; column: number; to: number };
export function changeTable(table: TableModel, op: TableOperation): SourceChange[] {
  if (!table.editable) throw new Error('Edit irregular tables in source mode');
  const rows = [table.rows[0], table.delimiter, ...table.rows.slice(1)];
  if (op.kind === 'moveRow') {
    const body = table.rows.slice(1);
    if (op.to < 0 || op.to >= body.length) return [];
    const moved = [...body]; moved.splice(op.to, 0, moved.splice(op.row, 1)[0]);
    return body.flatMap((r, i) => r === moved[i] ? [] : [{ from: r.from, to: r.to, insert: moved[i].text }]);
  }
  if (op.kind === 'moveColumn') {
    if (op.to < 0 || op.to >= table.align.length) return [];
    return rows.flatMap(r => {
      const moved = [...r.cells]; moved.splice(op.to, 0, moved.splice(op.column, 1)[0]);
      return r.cells.flatMap((cell, i) => cell === moved[i] ? [] : [{ from: cell.from, to: cell.to, insert: moved[i].text }]);
    });
  }
  if (op.kind === 'align') {
    const cell = table.delimiter.cells[op.column];
    const dashes = cell.text.replace(/:/g, '');
    return [{ from: cell.from, to: cell.to, insert: (op.align !== 'right' ? ':' : '') + dashes + (op.align !== 'left' ? ':' : '') }];
  }
  if (op.kind === 'insertRow') {
    const before = table.rows[op.row + 1];
    const text = table.rows[0].prefix + '| ' + table.align.map(() => '').join(' | ') + ' |';
    return before ? [{ from: before.from, to: before.from, insert: text + '\n' }] : [{ from: table.to, to: table.to, insert: '\n' + text }];
  }
  if (op.kind === 'deleteRow') {
    const r = table.rows[op.row + 1];
    return !r ? [] : [{ from: r.from - 1, to: r.to, insert: '' }];
  }
  const column = op.column;
  if (op.kind === 'insertColumn') return rows.map(r => {
    const next = r.cells[column];
    const last = r.cells.at(-1)!;
    const value = r === table.delimiter ? ' --- ' : '  ';
    return next ? { from: next.slotFrom, to: next.slotFrom, insert: value + '|' }
      : { from: last.slotTo, to: last.slotTo, insert: '|' + value };
  });
  if (table.align.length <= 1) return [];
  return rows.map(r => {
    const cell = r.cells[column];
    const next = r.cells[column + 1];
    return { from: next ? cell.slotFrom : cell.slotFrom - 1, to: next ? next.slotFrom : cell.slotTo, insert: '' };
  });
}
