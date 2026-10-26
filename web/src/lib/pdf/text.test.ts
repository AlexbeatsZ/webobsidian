import { expect, it } from 'vitest';
import { findPageMatches, pageText } from './text';
import type { TextContent } from 'pdfjs-dist/types/src/display/api';

function content(strings: string[]): TextContent {
  return { items: strings.map((str, index) => ({ str, dir: 'ltr', fontName: 'font', transform: [20, 0, 0, 20, 50, 720 - index * 30],
    width: str.length * 10, height: 20, hasEOL: index === strings.length - 1 })), styles: { font: { fontFamily: 'sans-serif', ascent: .8, descent: -.2, vertical: false } }, lang: 'en' };
}

it('keeps normalized matches aligned to original text offsets and shared percentage boxes', () => {
  const model = pageText(content(['NEEDLE alpha', ' and needle beta']), { width: 612, height: 792, transform: [1, 0, 0, -1, 0, 792] });
  const matches = findPageMatches(model, 'needle', 4);
  expect(matches.map(match => [match.page, match.from, match.to])).toEqual([[4, 0, 6], [4, 17, 23]]);
  expect(matches[0].boxes[0]).toEqual({ x: 50 / 612, y: 56 / 792, width: 60 / 612, height: 20 / 792 });
  expect(findPageMatches(model, '', 4)).toEqual([]);
});

it('matches across PDF text items and maps unicode normalization without rewriting source', () => {
  const model = pageText(content(['ﬃ NEE', 'DLE']), { width: 612, height: 792, transform: [1, 0, 0, -1, 0, 792] });
  expect(findPageMatches(model, 'ffi', 1)[0]).toMatchObject({ from: 0, to: 1 });
  expect(findPageMatches(model, 'needle', 1)[0].boxes).toHaveLength(2);
  expect(model.text).toBe('ﬃ NEEDLE\n');
});

it('does not fabricate searchable text for scanned pages', () => {
  const model = pageText({ items: [], styles: {}, lang: null }, { width: 612, height: 792, transform: [1, 0, 0, -1, 0, 792] });
  expect(findPageMatches(model, 'needle', 1)).toEqual([]);
});

it.each([
  { rotation: 90, transform: [0, 1, 1, 0, 0, 0], y: 50 / 612 },
  { rotation: 270, transform: [0, -1, -1, 0, 792, 612], y: 502 / 612 },
])('slices horizontal PDF text along its displayed direction after $rotation degree page rotation', ({ transform, y }) => {
  const model = pageText(content(['needle tail']), { width: 792, height: 612, transform });
  const box = findPageMatches(model, 'needle', 1)[0].boxes[0];
  expect(model.runs[0].axis).toBe('y');
  expect(box.y).toBeCloseTo(y, 8);
  expect(box.height).toBeCloseTo(60 / 612, 8);
  expect(box.width).toBeCloseTo(20 / 792, 8);
});
