import { readVaultConfiguration, writeVaultConfiguration, type VaultConfigurationSource } from './vaultConfiguration.js';

export type ConfiguredMenuSource = VaultConfigurationSource;
const relative = (source: VaultConfigurationSource): ConfiguredMenuSource => ({ ...source, path: source.path.slice('menus/'.length) });
/** Menu paths remain relative to their directory; storage belongs to Vault configuration. */
export async function readConfiguredMenu(file = 'menu.jsonc', expectedVault?: string): Promise<ConfiguredMenuSource> {
  return relative(await readVaultConfiguration('menus/' + file, expectedVault));
}
export async function writeConfiguredMenu(input: ConfiguredMenuSource): Promise<ConfiguredMenuSource> {
  return relative(await writeVaultConfiguration({ ...input, path: 'menus/' + input.path }));
}