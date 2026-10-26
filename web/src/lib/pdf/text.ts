import type { TextContent, TextItem } from 'pdfjs-dist/types/src/display/api';
import type { PdfBox, PdfMatch } from './types';

export interface PdfPageText {
  content: TextContent;
  text: string;
  width: number;
  height: number;
  runs: { from: number; to: number; item: TextItem; box: PdfBox; axis: 'x' | 'y'; reverse: boolean }[];
}

export function pageText(content: TextContent, viewport: { width: number; height: number; transform: number[] }): PdfPageText {
  let text = '';
  const runs: PdfPageText['runs'] = [];
  for (const item of content.items) {
    if (!('str' in item)) continue;
    const from = text.length;
    text += item.str;
    const matrix = viewport.transform, transform = item.transform;
    const baselineX = matrix[0] * transform[4] + matrix[2] * transform[5] + matrix[4];
    const baselineY = matrix[1] * transform[4] + matrix[3] * transform[5] + matrix[5];
    const axisX = matrix[0] * transform[0] + matrix[2] * transform[1];
    const axisY = matrix[1] * transform[0] + matrix[3] * transform[1];
    const verticalX = matrix[0] * transform[2] + matrix[2] * transform[3];
    const verticalY = matrix[1] * transform[2] + matrix[3] * transform[3];
    const fontHeight = Math.hypot(verticalX, verticalY) || item.height;
    const advance = Math.hypot(axisX, axisY) || fontHeight || 1;
    const scale = Math.hypot(matrix[0], matrix[1]);
    const ascent = content.styles[item.fontName]?.ascent ?? 0.8;
    const topX = baselineX + verticalX * ascent, topY = baselineY + verticalY * ascent;
    const endX = topX + axisX / advance * item.width * scale;
    const endY = topY + axisY / advance * item.width * scale;
    const axis = Math.abs(axisY) > Math.abs(axisX) ? 'y' : 'x';
    const reverse = ((axis === 'y' ? axisY : axisX) < 0) !== (item.dir === 'rtl');
    runs.push({ from, to: text.length, item, axis, reverse, box: {
      x: Math.min(topX, endX, topX - verticalX) / viewport.width,
      y: Math.min(topY, endY, topY - verticalY) / viewport.height,
      width: (Math.abs(endX - topX) + Math.abs(verticalX)) / viewport.width,
      height: (Math.abs(endY - topY) + Math.abs(verticalY)) / viewport.height,
    } });
    if (item.hasEOL) text += '\n';
  }
  return { content, text, runs, width: viewport.width, height: viewport.height };
}

function folded(text: string) {
  let value = '';
  const offsets: number[] = [];
  let offset = 0;
  for (const character of text) {
    const normalized = character.normalize('NFKC').toLowerCase();
    for (let index = 0; index < normalized.length; index++) offsets.push(offset);
    value += normalized;
    offset += character.length;
  }
  offsets.push(text.length);
  return { value, offsets };
}

export function findPageMatches(model: PdfPageText, query: string, page: number): PdfMatch[] {
  const needle = folded(query.trim()).value;
  if (!needle) return [];
  const haystack = folded(model.text), matches: PdfMatch[] = [];
  let cursor = 0;
  while ((cursor = haystack.value.indexOf(needle, cursor)) !== -1) {
    const from = haystack.offsets[cursor];
    let foldedEnd = cursor + needle.length;
    while (foldedEnd < haystack.offsets.length - 1 && haystack.offsets[foldedEnd] === haystack.offsets[foldedEnd - 1]) foldedEnd++;
    const to = haystack.offsets[foldedEnd];
    const boxes = model.runs.filter(run => run.to > from && run.from < to).map(run => {
      const count = Math.max(1, run.to - run.from);
      const start = (Math.max(from, run.from) - run.from) / count;
      const fraction = (Math.min(to, run.to) - Math.max(from, run.from)) / count;
      const offset = run.reverse ? 1 - start - fraction : start;
      if (run.axis === 'y') return { ...run.box, y: run.box.y + run.box.height * offset, height: run.box.height * fraction };
      return { ...run.box, x: run.box.x + run.box.width * offset, width: run.box.width * fraction };
    });
    matches.push({ id: `${page}:${from}:${to}`, page, from, to, boxes });
    cursor += Math.max(1, needle.length);
  }
  return matches;
}
