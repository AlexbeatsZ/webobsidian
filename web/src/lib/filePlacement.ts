import { FilePlacementSchema, defaultFileFolder } from '../../../server/src/contracts/filePlacement';
import { api } from './api';

/** Explicit paths stay explicit; bare new filenames follow the same preferences. */
export async function newFilePath(filename: string, sourcePath: string): Promise<string> {
  if (filename.includes('/')) return filename;
  const folder = await newFileFolder(sourcePath);
  return folder ? `${folder}/${filename}` : filename;
}

export async function newFileFolder(sourcePath: string): Promise<string> {
  return defaultFileFolder(FilePlacementSchema.parse((await api.getSettings()).vault), sourcePath);
}
