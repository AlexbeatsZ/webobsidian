import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { config, SETTINGS_FILE } from '../config.js';

/** ---- Schema (PRD §6) ---------------------------------------------------- */

const SettingsSchema = z.object({
  nativeFeatures: z.record(z.object({
    // Retained for explicit migration; active definitions belong to Vault files.
    automation: z.record(z.unknown()).optional(),
    tags: z.object({ batchEnabled: z.boolean(), wranglerEnabled: z.boolean(), migration: z.string().optional(),
      folderTags: z.object({ enabled: z.boolean(), pruneAncestors: z.boolean(), rules: z.array(z.object({
        folder: z.string(), tags: z.array(z.string()), recursive: z.boolean(),
      })) }).default({ enabled: false, pruneAncestors: true, rules: [] }),
    }),
    attachments: z.object({ excludeDirectories: z.array(z.string()), excludeExtensions: z.array(z.string()) }),
  })).default({}),
  writing: z.record(z.object({
    version: z.literal(1), migration: z.string(),
    latex: z.record(z.unknown()), linter: z.record(z.unknown()),
    hotkeys: z.record(z.array(z.object({modifiers:z.array(z.string()),key:z.string()}))).default({}),
  })).default({}),
  version: z.number().default(1),
  vault: z
    .object({
      path: z.string().default(''),
      allowedRoots: z.array(z.string()).default([]),
      trash: z.string().default('.trash'),
      // Xoá file: 'trash' = chuyển vào thư mục .trash (khôi phục được);
      // 'permanent' = xoá vĩnh viễn ngay.
      deleteMode: z.enum(['trash', 'permanent']).default('trash'),
      attachmentDir: z.string().default('attachments'),
    })
    .default({}),
  git: z
    .object({
      enabled: z.boolean().default(false),
      remote: z.string().default(''),
      branch: z.string().default('main'),
      token: z.string().default(''),
      authorName: z.string().default('WebObsidian'),
      authorEmail: z.string().default('webobsidian@localhost'),
      autoSync: z.boolean().default(false),
      autoCommitOnSave: z.boolean().default(false),
      intervalSec: z.number().default(300),
      lfsPatterns: z
        .array(z.string())
        .default(['*.png', '*.jpg', '*.jpeg', '*.gif', '*.pdf', '*.mp4', '*.mov', '*.zip']),
    })
    .default({}),
  search: z
    .object({
      chinese: z
        .object({
          enabled: z.boolean().default(true),
          traditional: z.boolean().default(false),
          fuzzyRules: z
            .array(z.tuple([z.string().regex(/^[a-z]{1,6}$/), z.string().regex(/^[a-z]{1,6}$/)]))
            .max(16)
            .default([]),
          usePath: z.boolean().default(false),
          attachments: z.boolean().default(true),
          showTags: z.boolean().default(true),
          tagFilter: z.boolean().default(true),
          showFirstHeading: z.boolean().default(true),
          headingIndent: z.boolean().default(true),
          templateFolder: z.string().default(''),
          pinnedCommands: z.array(z.string()).default([]),
          recentCommands: z.array(z.string()).max(100).default([]),
          historyKeys: z.string().default('1234567890'),
          shortcuts: z.record(z.string()).default({}),
          migration: z.string().default(''),
        })
        .default({}),
      fuzzy: z.number().default(0.2),
      prefix: z.boolean().default(true),
      indexFrontmatter: z.boolean().default(true),
    })
    .default({}),
  ui: z
    .object({
      theme: z.enum(['obsidian-dark', 'obsidian-light']).default('obsidian-light'),
      defaultView: z.enum(['live', 'source', 'reading']).default('live'),
    })
    .default({}),
  plugins: z
    .object({
      enabled: z.array(z.string()).default([]),
    })
    .default({}),
});

export type Settings = z.infer<typeof SettingsSchema>;

/** ---- Store --------------------------------------------------------------- */

let cache: Settings | null = null;

function defaults(): Settings {
  const base = SettingsSchema.parse({});
  base.vault.path = config.defaultVaultPath;
  base.vault.allowedRoots = config.allowedRoots.length
    ? config.allowedRoots
    : [path.dirname(config.defaultVaultPath), config.defaultVaultPath];
  return base;
}

/**
 * Guarantee the folder browser can reach the configured vault. The default
 * allowedRoots are derived from the sample vault, so pointing the vault at a
 * path outside them (e.g. ~/ObsidianVault) made Browse… return 403 with
 * "Path outside allowed roots". Add the vault's parent directory as a root
 * whenever it isn't already covered. Returns true if it mutated the draft.
 */
export function ensureVaultBrowsable(d: Settings): boolean {
  const vaultPath = path.resolve(d.vault.path);
  const roots = d.vault.allowedRoots ?? [];
  const covered = roots.some((r) => {
    const rr = path.resolve(r);
    return vaultPath === rr || vaultPath.startsWith(rr + path.sep);
  });
  if (covered) return false;
  d.vault.allowedRoots = [...roots, path.dirname(vaultPath)];
  return true;
}

async function ensureDataDir(): Promise<void> {
  await fs.mkdir(config.dataDir, { recursive: true });
}

/** Atomic write: write to tmp then rename; keep a .bak of the previous file. */
async function persist(s: Settings): Promise<void> {
  await ensureDataDir();
  const json = JSON.stringify(s, null, 2);
  const tmp = `${SETTINGS_FILE}.tmp-${randomBytes(4).toString('hex')}`;
  await fs.writeFile(tmp, json, { mode: 0o600 });
  try {
    await fs.copyFile(SETTINGS_FILE, `${SETTINGS_FILE}.bak`);
  } catch {
    /* no previous file */
  }
  await fs.rename(tmp, SETTINGS_FILE);
}

export async function loadSettings(): Promise<Settings> {
  if (cache) return cache;
  await ensureDataDir();
  try {
    const raw = await fs.readFile(SETTINGS_FILE, 'utf8');
    const parsed = SettingsSchema.parse(JSON.parse(raw));
    let dirty = false;
    // Heal older files whose allowedRoots predate the current vault path.
    if (ensureVaultBrowsable(parsed)) dirty = true;
    cache = parsed;
    if (dirty) await persist(cache);
  } catch {
    cache = defaults();
    await persist(cache);
  }
  return cache;
}

export async function getSettings(): Promise<Settings> {
  return cache ?? (await loadSettings());
}

/** Mutate settings via an updater fn, validate, persist, and refresh cache. */
let updateQueue:Promise<unknown>=Promise.resolve();
export function updateSettings(mutator: (draft: Settings) => void | Promise<void>): Promise<Settings> {
  const operation=updateQueue.catch(()=>{}).then(async()=>{
    const current = await getSettings();
    const draft: Settings = JSON.parse(JSON.stringify(current));
    await mutator(draft);
    const validated = SettingsSchema.parse(draft);
    await persist(validated);
    cache = validated;
    return validated;
  });
  updateQueue=operation;return operation;
}

/** Redact secrets for sending to the client. */
export function redactSettings(s: Settings) {
  // Writing rules have a dedicated Vault-scoped endpoint, not every settings payload.
  const {writing,nativeFeatures,...publicSettings}=s;
  return {
    ...publicSettings,
    git: { ...s.git, token: s.git.token ? '••••••••' : '' },
  };
}
