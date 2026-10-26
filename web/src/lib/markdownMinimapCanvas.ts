import type { EditorView } from '@codemirror/view';
import type { MarkdownModel, SourceSpan } from '@webobsidian/markdown-core';
import { MINIMAP_MAX_HEIGHT, minimapRows, type MinimapRow, type MinimapWidth } from './markdownMinimap';

export function paintMarkdownMinimap(image: HTMLCanvasElement, host: HTMLElement, view: EditorView,
  model: MarkdownModel, widthMetrics: MinimapWidth, ranges: SourceSpan[], searchRows: number[]) {
  const width = Math.max(1, Math.min(512, Math.round(host.clientWidth)));
  const height = Math.max(1, Math.min(MINIMAP_MAX_HEIGHT, Math.round(host.clientHeight)));
  image.width = width; image.height = height;
  const context = image.getContext('2d');
  if (!context) return;
  const style = getComputedStyle(host);
  const colors = { text: style.getPropertyValue('--text-muted').trim() || '#888',
    accent: style.getPropertyValue('--interactive-accent').trim() || '#7b6cd9',
    search: style.getPropertyValue('--minimap-match').trim() || '#ddaa33' };
  context.clearRect(0, 0, width, height);
  const rows = minimapRows(model, view.state.doc, height);
  const columnStyle = getComputedStyle(view.contentDOM);
  const scale = width / widthMetrics.source;
  const paddingLeft = Math.max(0, parseFloat(columnStyle.paddingLeft) || 0);
  const paddingRight = Math.max(0, parseFloat(columnStyle.paddingRight) || 0);
  const textLeft = Math.min(width - 1, paddingLeft * scale);
  const columnText = Math.max(1, widthMetrics.column - paddingLeft - paddingRight);
  const textWidth = Math.max(1, Math.min(width - textLeft, columnText * scale));
  const rowPitch = height / Math.max(1, rows.length);
  const fontPx = Math.max(1, Math.min((parseFloat(columnStyle.fontSize) || 18) * scale, rowPitch * 0.85));
  const textRows: MinimapRow[] = [];
  for (const row of rows) {
    const top = (row.line - 1) / view.state.doc.lines * height;
    const rowHeight = Math.max(1, (row.endLine - row.line + 1) / view.state.doc.lines * height - 1);
    if (['image', 'math', 'table', 'code'].includes(row.kind)) {
      const barWidth = row.kind === 'math' ? Math.max(1, textWidth * 0.6) : textWidth;
      context.fillStyle = colors.accent;
      context.globalAlpha = 0.55;
      context.fillRect(textLeft + (textWidth - barWidth) / 2, top, barWidth, Math.min(5, rowHeight));
      continue;
    }
    textRows.push(row);
  }
  if (textRows.length) {
    context.save();
    context.beginPath();
    context.rect(textLeft, 0, textWidth, height);
    context.clip();
    context.font = `${fontPx}px monospace`;
    context.textBaseline = 'top';
    context.globalAlpha = 0.75;
    for (const row of textRows) {
      context.fillStyle = row.kind === 'heading' ? colors.accent : colors.text;
      context.fillText(row.text, textLeft, (row.line - 1) / view.state.doc.lines * height);
    }
    context.restore();
  }
  context.globalAlpha = 1;
  const bins = new Set<number>();
  context.fillStyle = colors.search;
  for (const range of ranges) {
    const top = Math.floor((view.state.doc.lineAt(range.from).number - 1) / view.state.doc.lines * height);
    if (!bins.has(top)) { context.fillRect(0, top, width, 2); bins.add(top); }
  }
  context.fillStyle = colors.accent;
  for (const line of searchRows) context.fillRect(width - 8, (line - 1) / view.state.doc.lines * height, 8, 2);
  image.dataset.paintCount = String(Number(image.dataset.paintCount ?? 0) + 1);
  image.dataset.sourceLines = String(view.state.doc.lines);
  image.dataset.markerCount = String(searchRows.length);
  image.dataset.lastSearchLine = String(searchRows.at(-1) ?? 0);
  image.dataset.workspaceMarkerCount = String(ranges.length);
  image.dataset.sourceWidth = String(widthMetrics.source);
  image.dataset.columnWidth = String(widthMetrics.column);
  image.dataset.widthScale = scale.toFixed(4);
}
