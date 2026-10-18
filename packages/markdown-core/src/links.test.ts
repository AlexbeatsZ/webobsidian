import { expect, it } from 'vitest';
import { parseLinkTarget, resolveTarget } from './links.js';

it('resolves relative links from the source note and preserves fragment semantics', () => {
  expect(parseLinkTarget('Note#^block|alias')).toMatchObject({ path: 'Note', fragment: '^block', alias: 'alias' });
  expect(resolveTarget('../Shared/Note#Heading', 'Folder/Source.md', ['Shared/Note.md', 'Elsewhere/Note.md']))
    .toMatchObject({ path: 'Shared/Note.md', fragment: 'Heading', status: 'resolved' });
  expect(resolveTarget('Note', 'Source.md', ['A/Note.md', 'B/Note.md']).status).toBe('ambiguous');
});
