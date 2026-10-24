import { describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ raw: '' }));
vi.mock('./vaultFile.js', () => ({ readFileText: async () => fixture.raw, getVaultRoot: () => '/fixture' }));
vi.mock('./catalog.js', () => ({ catalog: {}, VaultCatalog: class {}, CORE_LIST_PROPS: [], CATALOG_SCHEMA_VERSION: 1 }));
import { QmdEngine } from './search.js';
import { SourceDocument } from '../../../packages/markdown-core/src/source.js';

describe('search navigation source coordinates', () => {
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
