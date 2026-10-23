import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getSettings, updateSettings } from './settings.js';

/** Read legacy configuration only; never alter the original Obsidian plugin or hotkeys. */
export async function migrateSearchSettings() {
  const settings = await getSettings();
  if (settings.search.chinese.migration) return;
  const root = settings.vault.path;
  const read = async (file: string) => {
    try {
      return JSON.parse(
        (await fs.readFile(path.join(root, '.obsidian', file), 'utf8')).replace(/^\uFEFF/, ''),
      );
    } catch (error: any) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  };
  const legacy = await read('plugins/fuzzy-chinese-pinyin/data.json');
  const templates = await read('templates.json');
  await updateSettings((d) => {
    const next = d.search.chinese;
    if (legacy) {
      const global = legacy.global ?? {},
        file = legacy.file ?? {};
      if (typeof global.traditionalChineseSupport === 'boolean')
        next.traditional = global.traditionalChineseSupport;
      if (typeof file.usePathToSearch === 'boolean') next.usePath = file.usePathToSearch;
      if (typeof file.showAttachments === 'boolean') next.attachments = file.showAttachments;
      if (typeof file.showTags === 'boolean') next.showTags = file.showTags;
      if (typeof file.searchWithTag === 'boolean') next.tagFilter = file.searchWithTag;
      if (typeof legacy.heading?.showFirstLevelHeading === 'boolean')
        next.showFirstHeading = legacy.heading.showFirstLevelHeading;
      if (typeof legacy.heading?.headingIndent === 'boolean')
        next.headingIndent = legacy.heading.headingIndent;
      if (Array.isArray(legacy.command?.pinnedCommands))
        next.pinnedCommands = legacy.command.pinnedCommands.filter((v: unknown) => typeof v === 'string');
      if (global.fuzzyPinyin && Array.isArray(global.fuzzyPinyinSetting))
        next.fuzzyRules = global.fuzzyPinyinSetting
          .filter(
            (v: unknown) =>
              Array.isArray(v) &&
              v.length === 2 &&
              v.every((x) => typeof x === 'string' && /^[a-z]{1,6}$/.test(x)),
          )
          .slice(0, 16);
    }
    if (typeof templates?.folder === 'string' && !next.templateFolder) next.templateFolder = templates.folder;
    next.migration = legacy
      ? 'Imported supported Fuzzy Chinese Pinyin settings; original files preserved.'
      : 'Built-in defaults';
  });
}
