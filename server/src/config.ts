import path from 'node:path';

/** Runtime configuration derived from environment variables. */
export interface RuntimeConfig {
  port: number;
  host: string;
  dataDir: string;
  defaultVaultPath: string;
  allowedRoots: string[];
  isProd: boolean;
}

function resolveRoots(): string[] {
  const raw = process.env.ALLOWED_ROOTS?.trim();
  if (raw) {
    return raw.split(',').map((p) => path.resolve(p.trim())).filter(Boolean);
  }
  return [];
}

export const config: RuntimeConfig = {
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? '127.0.0.1',
  dataDir: path.resolve(process.env.DATA_DIR ?? './data'),
  defaultVaultPath: path.resolve(process.env.VAULT_PATH ?? './sample-vault'),
  allowedRoots: resolveRoots(),
  isProd: process.env.NODE_ENV === 'production',
};

export const SETTINGS_FILE = path.join(config.dataDir, 'settings.json');
export const INDEX_FILE = path.join(config.dataDir, 'qmd-index.json');
