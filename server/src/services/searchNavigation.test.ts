import { describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ raw: '' }));
vi.mock('./vaultFile.js', () => ({ readFileText: async () => fixture.raw, getVaultRoot: () => '/fixture' }));
vi.mock('./catalog.js', () => ({ catalog: {}, VaultCatalog: class {}, CORE_LIST_PROPS: [], CATALOG_SCHEMA_VERSION: 1 }));
import { QmdEngine } from './search.js';
import { SourceDocument } from '@webobsidian/markdown-core';

describe('search navigation source coordinates', () => {
  it('publishes every computed source match even when context previews are truncated', async () => {
    fixture.raw = '\ufeff---\r\ntitle: Fixture\r\n---\r\n' + Array.from({ length: 30 }, (_, index) => `${index} target target ${'padding '.repeat(20)}\r\n`).join('');
    const result = await new QmdEngine().matchesFor('fixture.md', ['target'], { maxContexts: 2 });
    const text = new SourceDocument(fixture.raw).text;
    expect(result.contexts).toHaveLength(2);
    expect(result.sourceRanges).toHaveLength(60);
    expect(result.count).toBe(60);
    for (const range of result.sourceRanges!) expect(text.slice(range.from, range.to)).toBe(range.text);
  });
  it('keeps match offsets in normalized editor text after BOM and CRLF frontmatter', async () => {
    fixture.raw = '\ufeff---\r\ntitle: Fixture\r\n---\r\n\r\n正文 target\r\n\r\n' + 'filler '.repeat(30) + 'target again';
    const result = await new QmdEngine().matchesFor('fixture.md', ['target']);
    const normalized = new SourceDocument(fixture.raw).text;
    expect(result.count).toBe(2);
    expect(result.contexts).toHaveLength(2);
    for (const context of result.contexts) {
      expect(context.source).toBeDefined();
      expect(normalized.slice(context.source!.from, context.source!.to)).toBe('target');
      expect(context.source!.text).toBe('target');
    }
    expect(fixture.raw).toContain('\ufeff---\r\n');
  });
});
