import { z } from 'zod';

// Vault-relative folders only. Both browser settings and upload routing use this
// contract; resolveInVault remains the filesystem boundary.
export const VaultFolderSchema = z.string().trim().max(4096).refine(value =>
  value === '' || value.split('/').every(part => !!part && part !== '.' && part !== '..' &&
    !/[<>:"\\|?*\u0000-\u001f]/.test(part) && !/[. ]$/.test(part)),
  '请输入有效的仓库相对文件夹路径');

export const FilePlacementSchema = z.object({
  newFileLocation: z.enum(['root', 'current', 'folder']).default('root'),
  newFileFolder: VaultFolderSchema.default(''),
  attachmentLocation: z.enum(['root', 'current', 'folder', 'subfolder']).default('folder'),
  attachmentDir: VaultFolderSchema.default('attachments'),
});
export type FilePlacement = z.infer<typeof FilePlacementSchema>;

export function defaultFileFolder(settings: FilePlacement, sourcePath = '', attachment = false): string {
  const parent = !sourcePath.includes('://') && sourcePath.includes('/') ? sourcePath.slice(0, sourcePath.lastIndexOf('/')) : '';
  const location = attachment ? settings.attachmentLocation : settings.newFileLocation;
  const folder = attachment ? settings.attachmentDir : settings.newFileFolder;
  if (location === 'current') return parent;
  if (location === 'folder') return folder;
  if (location === 'subfolder') return [parent, folder].filter(Boolean).join('/');
  return '';
}
