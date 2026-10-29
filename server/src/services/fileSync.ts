import path from 'node:path';
import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { FileSyncPreferencesSchema, type FileSyncPreferences } from '../contracts/fileSync.js';
import { getSettings, updateSettings } from './settings.js';
import { getVaultRoot, vaultPathKey } from './vaultFile.js';
import { FileSyncEngine } from './fileSyncEngine.js';
import { normalizeSyncEndpoint } from './syncTransport.js';
import { queueFileUpdate, drainFileUpdates, setFileSyncNotifier } from './fileupdates.js';
import { withVaultMaintenance } from './vaultMaintenance.js';
import { broadcast } from './realtime.js';

let current: { root: string; signature: string; engine: FileSyncEngine } | undefined;
let recovering = false;
let timer: NodeJS.Timeout | undefined;
let debounce: NodeJS.Timeout | undefined;
let lastAttempt = 0;

export async function fileSyncPreferences(): Promise<FileSyncPreferences> {
  const root = await getVaultRoot();
  return FileSyncPreferencesSchema.parse((await getSettings()).fileSync[vaultPathKey(root)] ?? {});
}

export async function fileSyncEngine(): Promise<FileSyncEngine> {
  const root = await getVaultRoot(); const preferences = await fileSyncPreferences();
  const signature = JSON.stringify(preferences);
  if (current?.root === root && current.signature === signature) return current.engine;
  const directory = path.join(config.dataDir, 'file-sync', createHash('sha256').update(vaultPathKey(root)).digest('hex'));
  const engine = new FileSyncEngine(root, directory, preferences, {
    publish: async work => {
      if (vaultPathKey(await getVaultRoot()) !== vaultPathKey(root)) throw new Error('Vault 已切换，同步未写入文件');
      if (recovering) return work();
      return withVaultMaintenance(drainFileUpdates, async () => {
        if (vaultPathKey(await getVaultRoot()) !== vaultPathKey(root)) throw new Error('Vault 已切换，同步已停止');
        return work();
      });
    },
    changed: async (relative, deleted) => { await queueFileUpdate(relative, deleted ? 'unlink' : 'change'); },
    conflict: async snapshot => {
      if (!(await getSettings()).git.enabled) return [];
      const { recordSyncConflict } = await import('./git.js');
      return recordSyncConflict(root, snapshot);
    },
  });
  await engine.load(); current = { root, signature, engine }; lastAttempt = 0;
  return engine;
}

export async function saveFileSyncPreferences(value: unknown): Promise<void> {
  const parsed = FileSyncPreferencesSchema.strict().safeParse(value);
  if (!parsed.success) throw Object.assign(new Error('同步设置格式无效'), { status: 400 });
  const preferences = parsed.data;
  const root = await getVaultRoot();
  if (current?.engine.busy) throw Object.assign(new Error('正在同步，请完成后再修改连接设置'), { status: 409 });
  try { preferences.endpoints = preferences.endpoints.map(normalizeSyncEndpoint); }
  catch (error) { throw Object.assign(error as Error, { status: 400 }); }
  if (preferences.enabled && !preferences.endpoints.length) throw Object.assign(new Error('请填写同步地址'), { status: 400 });
  const previous = await fileSyncPreferences();
  if (preferences.token === '••••••••') preferences.token = previous.token;
  if (preferences.enabled && !/^[\x21-\x7e]{32,512}$/.test(preferences.token)) throw Object.assign(new Error('访问令牌需要 32–512 个 ASCII 字符'), { status: 400 });
  if (preferences.enabled) {
    try { await (await fileSyncEngine()).validateRoot(); }
    catch (error) { throw Object.assign(error as Error, { status: 400 }); }
  }
  await updateSettings(draft => { draft.fileSync[vaultPathKey(root)] = preferences; });
  current = undefined;
}

export async function runFileSync() {
  const engine = await fileSyncEngine(); lastAttempt = Date.now();
  const status = await engine.run(); broadcast({ type: 'file-sync', ...status }); return status;
}

export async function recoverFileSync(): Promise<void> {
  if (!(await fileSyncPreferences()).enabled) return;
  recovering = true;
  try { await (await fileSyncEngine()).recover(); }
  catch (error) { console.warn('[file-sync] recovery paused:', (error as Error).message); }
  finally { recovering = false; }
}

export function noteFileSyncChange(relative: string): void {
  if (!current) return;
  current.engine.noteChanged(relative);
  if (!current.engine.preferences.enabled) return;
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => { void runFileSync().catch(error => console.warn('[file-sync]', error.message)); }, 1500);
  debounce.unref();
}

export function startFileSync(): void {
  setFileSyncNotifier(noteFileSyncChange);
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    void (async () => {
      const preferences = await fileSyncPreferences();
      if (preferences.enabled && Date.now() - lastAttempt >= preferences.intervalSec * 1000) await runFileSync();
    })().catch(error => console.warn('[file-sync]', error.message));
  }, 5000);
  timer.unref();
}
