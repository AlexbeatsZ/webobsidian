import { z } from 'zod';
import { parseConfiguration, readVaultConfiguration, writeVaultConfiguration, type VaultConfigurationSource } from './vaultConfiguration.js';

/**
 * Vault notes the user chose as standing instructions for MCP clients (Settings › MCP).
 * Stored with the Vault so every device and file-sync peer shares the same rules.
 */
export const MCP_CONFIGURATION = 'mcp.jsonc';
export const MCP_CONFIGURATION_PATH = `.obsidian/webobsidian/${MCP_CONFIGURATION}`;
export const MAX_INSTRUCTION_NOTES = 20;

const notePath = z.string().trim().min(1).max(1024).refine(value => /\.md$/i.test(value) && !value.startsWith('/') &&
  !value.replace(/\\/g, '/').split('/').some(part => !part || part.startsWith('.')), '只能选择可见的 Markdown 笔记');
export const McpPreferencesSchema = z.object({
  instructionNotes: z.array(notePath).max(MAX_INSTRUCTION_NOTES).default([]),
}).strict();
export type McpPreferences = z.infer<typeof McpPreferencesSchema>;

export async function readMcpPreferences(): Promise<{ source: VaultConfigurationSource; preferences: McpPreferences }> {
  const source = await readVaultConfiguration(MCP_CONFIGURATION);
  const parsed = McpPreferencesSchema.safeParse(source.exists ? parseConfiguration(source.content) : {});
  if (!parsed.success) throw Object.assign(new Error('MCP 配置格式无效：' + parsed.error.issues[0]?.message), { status: 400 });
  return { source, preferences: parsed.data };
}

export async function saveMcpPreferences(source: VaultConfigurationSource, value: unknown) {
  const preferences = McpPreferencesSchema.parse(value);
  const unique = [...new Set(preferences.instructionNotes.map(note => note.replace(/\\/g, '/')))];
  await writeVaultConfiguration({ ...source, path: MCP_CONFIGURATION,
    content: JSON.stringify({ instructionNotes: unique } satisfies McpPreferences, null, 2) + '\n' });
  return readMcpPreferences();
}
