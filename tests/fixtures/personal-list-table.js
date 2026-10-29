const items = block.list();
if (!items.length) throw new Error('list2table requires a Markdown list.');
const children = items.map(() => []);
const roots = [];
for (let i = 0; i < items.length; i++) {
  if (items[i].parent === null) roots.push(i);
  else children[items[i].parent].push(i);
}
const counts = items.map(() => 1);
for (let i = items.length - 1; i >= 0; i--) {
  if (children[i].length) counts[i] = children[i].reduce((sum, child) => sum + counts[child], 0);
}
const totalRows = roots.reduce((sum, root) => sum + counts[root], 0);
const doc = block.container.ownerDocument;
const table = doc.createElement('table'); table.className = 'cm-table';
const body = doc.createElement('tbody'); table.append(body); block.container.append(table);
const rows = Array.from({ length: totalRows }, () => { const row = doc.createElement('tr'); body.append(row); return row; });
const mounts = [];
const firstRow = items.map(() => 0);
const place = (indices, row) => {
  for (const index of indices) {
    firstRow[index] = row;
    place(children[index], row);
    row += counts[index];
  }
};
place(roots, 0);
for (let i = 0; i < items.length; i++) {
  const cell = doc.createElement('td'); cell.rowSpan = counts[i];
  rows[firstRow[i]].append(cell);
  mounts.push(block.renderMarkdown(items[i].text, cell));
}
await Promise.all(mounts);
