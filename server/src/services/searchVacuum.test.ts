import { expect, it, vi } from 'vitest';
vi.mock('./vaultFile.js', () => ({ readFileText: async () => '', getVaultRoot: () => '/fixture' }));
import { QmdEngine } from './search.js';
import { VaultCatalog } from './catalog.js';
import { parseNote } from './markdown.js';

it('repeated saves vacuum stale postings without leaving an interleavable batch', () => {
  const engine = new QmdEngine(new VaultCatalog());
  engine.upsertNote('stable.md', parseNote('stable.md', 'kept body'));
  for (let index = 0; index < 1500; index++) engine.upsertNote('note.md', parseNote('note.md', `revision${index} body`));
  const mini = engine['mini'];
  // The unbatched pass completes synchronously inside the triggering save.
  expect(mini.dirtCount).toBeLessThan(1000);
  expect(mini.search('revision1499').map(hit => hit.id)).toEqual(['note.md']);
  expect(mini.search('revision0', { prefix: false, fuzzy: false })).toEqual([]);
  expect(mini.search('kept').map(hit => hit.id)).toEqual(['stable.md']);
});
