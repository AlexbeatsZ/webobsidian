import { describe, expect, it } from 'vitest';
import { SourceDocument } from './source.js';

describe('lossless source editing', () => {
  it('changes one character without changing BOM or mixed line endings', () => {
    const raw = '\ufeff甲\r\nsecond\nthird\rfourth';
    const doc = new SourceDocument(raw);
    expect(doc.text).toBe('甲\nsecond\nthird\nfourth');
    doc.apply([{ from: 2, to: 3, insert: 'S' }]);
    expect(doc.raw).toBe('\ufeff甲\r\nSecond\nthird\rfourth');
  });

  it('restores exact mixed newlines after an edit across line boundaries', () => {
    const raw = '\ufeffa\r\nb\nc\rd';
    const doc = new SourceDocument(raw);
    const inverse = doc.apply([{ from: 1, to: 6, insert: '新\n文' }]);
    expect(doc.text).toBe('a新\n文d');
    doc.apply(inverse);
    expect(doc.raw).toBe(raw);
  });

  it('applies simultaneous edits against the original coordinates', () => {
    const doc = new SourceDocument('a\r\nb\nc');
    const inverse = doc.apply([{ from: 0, to: 1, insert: '甲乙' }, { from: 4, to: 5, insert: '丙' }]);
    expect(doc.raw).toBe('甲乙\r\nb\n丙');
    doc.apply(inverse);
    expect(doc.raw).toBe('a\r\nb\nc');
  });

  it('rejects an invalid transaction before changing any source', () => {
    const doc = new SourceDocument('abc');
    expect(() => doc.apply([{ from: 0, to: 2, insert: '' }, { from: 1, to: 3, insert: '' }])).toThrow();
    expect(doc.raw).toBe('abc');
  });
});
