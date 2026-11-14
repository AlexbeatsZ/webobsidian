import path from 'node:path';

/** Runtime configuration derived from environment variables. */
export interface RuntimeConfig {
  port: number;
  host: string;
  dataDir: string;
  defaultVaultPath: string;
  allowedRoots: string[];
}

function resolveRoots(): string[] {
  if (process.env.ALLOWED_ROOTS_JSON) {
    const roots: unknown = JSON.parse(process.env.ALLOWED_ROOTS_JSON);
    if (!Array.isArray(roots) || roots.some(root => typeof root !== 'string')) throw new Error('Invalid allowed roots');
    return roots.map(root => path.resolve(root));
  }
  const raw = process.env.ALLOWED_ROOTS?.trim();
  if (raw) {
    return raw.split(',').map((p) => path.resolve(p.trim())).filter(Boolean);
  }
  return [];
}

export const config: RuntimeConfig = {
  port: Number(process.env.PORT ?? 8787),
  host: '127.0.0.1',
  dataDir: path.resolve(process.env.DATA_DIR ?? './data'),
  defaultVaultPath: path.resolve(process.env.VAULT_PATH ?? './sample-vault'),
  allowedRoots: resolveRoots(),
};

export const SETTINGS_FILE = path.join(config.dataDir, 'settings.json');
export const INDEX_FILE = path.join(config.dataDir, 'qmd-index.json');

// Legacy platform environment remains accepted for old development launchers.
export const runtimeCapabilities = {
  get searchCache() { return process.env.WEBOBSIDIAN_SEARCH_CACHE !== undefined
    ? process.env.WEBOBSIDIAN_SEARCH_CACHE !== '0' : process.env.WEBOBSIDIAN_PLATFORM !== 'android'; },
  get indexProgress() { return process.env.WEBOBSIDIAN_INDEX_PROGRESS !== undefined
    ? process.env.WEBOBSIDIAN_INDEX_PROGRESS === '1' : process.env.WEBOBSIDIAN_PLATFORM === 'android'; },
};
