import { promises as fs } from 'node:fs';
import { modify, applyEdits } from 'jsonc-parser';
import { z } from 'zod';
import { resolveInVault, readFileSnapshot } from './vaultFile.js';
import { readObsidianConfiguration, writeObsidianAppearance, parseConfiguration, type VaultConfigurationSource } from './vaultConfiguration.js';

const appearanceSchema = z.object({ enabledCssSnippets: z.array(z.string()).default([]) }).passthrough();
const snippetPath = (name: string) => {
  if (!name || name.length > 244 || !/\.css$/i.test(name) || /[\\/:*?"<>|\x00-\x1f]/.test(name) || /[. ]$/.test(name))
    throw Object.assign(new Error('Invalid CSS snippet name'), { status: 400 });
  return `.obsidian/snippets/${name}`;
};
export async function readCssSnippets() {
  const source = await readObsidianConfiguration('appearance.json');
  const appearance = appearanceSchema.parse(source.exists ? parseConfiguration(source.content) : {});
  let entries: import('node:fs').Dirent[];
  try { entries = await fs.readdir(await resolveInVault('.obsidian/snippets'), { withFileTypes: true }); }
  catch (error: any) { if (error.code !== 'ENOENT') throw error; entries = []; }
  const snippets = await Promise.all(entries.filter(entry => entry.isFile() && /\.css$/i.test(entry.name)).map(async entry => {
    const name = entry.name.slice(0, -4), path = snippetPath(entry.name);
    const stat = await fs.stat(await resolveInVault(path));
    return { name, path, enabled: appearance.enabledCssSnippets.includes(name), stamp: `${stat.mtimeMs}-${stat.size}` };
  }));
  if ((await readObsidianConfiguration('appearance.json')).vault !== source.vault) throw Object.assign(new Error('Vault changed'), { status: 409 });
  return { source, enabled: appearance.enabledCssSnippets, snippets: snippets.sort((a, b) => a.name.localeCompare(b.name)) };
}
export async function setCssSnippetEnabled(source: VaultConfigurationSource, name: string, enabled: boolean) {
  snippetPath(name + '.css');
  const current = await readCssSnippets();
  if (!current.snippets.some(snippet => snippet.name === name)) throw Object.assign(new Error('CSS snippet does not exist'), { status: 404 });
  const names = current.enabled.filter(value => value !== name);
  if (enabled) names.push(name);
  // Only patch the enabled list; keep every unrelated appearance field and byte.
  const content = applyEdits(source.content || '{}', modify(source.content || '{}', ['enabledCssSnippets'], names,
    { formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' } }));
  await writeObsidianAppearance({ ...source, content });
  return readCssSnippets();
}
export async function readCssSnippet(file: string, vault: string) {
  const source = await readObsidianConfiguration('appearance.json');
  if (source.vault !== vault) throw Object.assign(new Error('Vault changed'), { status: 409 });
  const path = snippetPath(file), stat = await fs.stat(await resolveInVault(path));
  if (!stat.isFile() || stat.size > 1024 * 1024) throw Object.assign(new Error('CSS snippet must be at most 1 MiB'), { status: 413 });
  const value = await readFileSnapshot(path);
  if ((await readObsidianConfiguration('appearance.json')).vault !== vault) throw Object.assign(new Error('Vault changed'), { status: 409 });
  return value.content;
}
