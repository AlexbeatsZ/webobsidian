const model = block.table();
if (!model || !model.editable) throw new Error('exTable requires a regular Markdown table; edit irregular tables in source.');
const doc = block.container.ownerDocument;
const grid = model.rows.map(() => []);
const anchors = [];
for (let r = 0; r < model.rows.length; r++) {
  for (let c = 0; c < model.align.length; c++) {
    const value = model.rows[r].cells[c].text.trim();
    let anchor;
    if (value === '<') anchor = grid[r][c - 1];
    else if (value === '^') anchor = grid[r - 1]?.[c];
    else {
      anchor = { row: r, col: c, lastRow: r, lastCol: c, source: model.rows[r].cells[c].text };
      anchors.push(anchor);
    }
    if (!anchor) throw new Error('A table merge marker has no preceding cell.');
    grid[r][c] = anchor;
    anchor.lastRow = Math.max(anchor.lastRow, r);
    anchor.lastCol = Math.max(anchor.lastCol, c);
  }
}
for (const anchor of anchors) {
  for (let r = anchor.row; r <= anchor.lastRow; r++) {
    for (let c = anchor.col; c <= anchor.lastCol; c++) {
      if (grid[r][c] !== anchor) throw new Error('Merged cells must form a rectangle.');
    }
  }
}
const table = doc.createElement('table'); table.className = 'cm-table';
const body = doc.createElement('tbody'); table.append(body); block.container.append(table);
const rows = model.rows.map(() => { const row = doc.createElement('tr'); body.append(row); return row; });
await Promise.all(anchors.map(async anchor => {
  const cell = doc.createElement(anchor.row === 0 ? 'th' : 'td');
  cell.rowSpan = anchor.lastRow - anchor.row + 1;
  cell.colSpan = anchor.lastCol - anchor.col + 1;
  cell.style.textAlign = model.align[anchor.col] || '';
  rows[anchor.row].append(cell);
  await block.renderMarkdown(anchor.source, cell);
}));
