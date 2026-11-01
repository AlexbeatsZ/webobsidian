import { describe, expect, it } from 'vitest';
import { FilePlacementSchema, defaultFileFolder } from './filePlacement.js';

describe('file placement preferences', () => {
  it('preserves existing root-note and configured-attachment defaults', () => {
    const settings = FilePlacementSchema.parse({ attachmentDir: 'Media' });
    expect(defaultFileFolder(settings, 'Notes/A.md')).toBe('');
    expect(defaultFileFolder(settings, 'Notes/A.md', true)).toBe('Media');
  });
  it('resolves current, root, specified and note-relative attachment folders', () => {
    const settings = FilePlacementSchema.parse({ newFileLocation: 'current', attachmentLocation: 'subfolder', attachmentDir: 'assets/images' });
    expect(defaultFileFolder(settings, 'Notes/A.md')).toBe('Notes');
    expect(defaultFileFolder(settings, 'Notes/A.md', true)).toBe('Notes/assets/images');
    expect(defaultFileFolder(settings, '', true)).toBe('assets/images');
    expect(defaultFileFolder(settings, 'home://page')).toBe('');
    expect(defaultFileFolder(settings, 'home://page', true)).toBe('assets/images');
    expect(defaultFileFolder({ ...settings, newFileLocation: 'folder', newFileFolder: 'Inbox' })).toBe('Inbox');
    expect(defaultFileFolder({ ...settings, attachmentLocation: 'root' }, 'Notes/A.md', true)).toBe('');
  });
  it('rejects absolute, traversing and invalid folder paths', () => {
    for (const folder of ['/tmp', '../outside', 'a/../b', 'C:/vault', 'a\\b', 'a//b', 'a/.', 'a/hidden.', 'a?'])
      expect(FilePlacementSchema.safeParse({ attachmentDir: folder }).success, folder).toBe(false);
  });
});
