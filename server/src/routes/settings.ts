import { Router } from 'express';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { asyncHandler } from '../middleware/error.js';
import { getSettings, updateSettings, redactSettings, ensureVaultBrowsable } from '../services/settings.js';
import { config } from '../config.js';
import { broadcast } from '../services/realtime.js';
import { withVaultMaintenance } from '../services/vaultMaintenance.js';
import { drainFileUpdates } from '../services/fileupdates.js';
import { selectVaultWorkspace } from '../services/uistate.js';
import { z } from 'zod';
import { readCssSnippets, readCssSnippet, setCssSnippetEnabled } from '../services/cssSnippets.js';
import { readHotkeys, patchHotkeys } from '../services/hotkeySettings.js';
import { DebugLog } from '../services/debugLog.js';
import { UiSettingsSchema } from '../contracts/uiSettings.js';

let switchRuntime = async (_commit: () => Promise<void>): Promise<void> => { throw new Error('Vault switch runtime is not ready'); };
/** The server owns its existing watcher and index lifecycle. */
export function configureVaultSwitch(handler: typeof switchRuntime): void { switchRuntime = handler; }

export const settingsRouter = Router();
const debugLog = new DebugLog(path.join(config.dataDir, 'debug'));
settingsRouter.post('/debug', asyncHandler(async (req, res) => {
  if (!(await getSettings()).ui.debugRecording) throw Object.assign(new Error('调试记录未开启'), { status: 409 });
  const events = z.array(z.object({ session: z.string().max(80), sequence: z.number().int().nonnegative(),
    time: z.string().max(40), elapsed: z.number(), type: z.string().max(100), data: z.unknown() }).strict()).min(1).max(256).parse(req.body);
  if (Buffer.byteLength(JSON.stringify(events)) > 2 * 1024 * 1024) throw Object.assign(new Error('调试批次过大'), { status: 413 });
  await debugLog.append(events); res.json({ ok: true });
}));
settingsRouter.get('/debug', asyncHandler(async (_req, res) => { res.json({ text: await debugLog.read() }); }));
settingsRouter.delete('/debug', asyncHandler(async (_req, res) => { await debugLog.clear(); res.json({ ok: true }); }));
settingsRouter.get('/css-snippets', asyncHandler(async (_req, res) => { res.json(await readCssSnippets()); }));
settingsRouter.put('/css-snippets', asyncHandler(async (req, res) => {
  const input = z.object({ source: z.object({ path: z.literal('appearance.json'), content: z.string().max(1024 * 1024),
    exists: z.boolean(), revision: z.string().optional(), vault: z.string() }).strict(), name: z.string(), enabled: z.boolean() }).strict().parse(req.body);
  const value = await setCssSnippetEnabled(input.source, input.name, input.enabled);
  broadcast({ type: 'vault-configuration-changed', path: '.obsidian/appearance.json', event: 'change' });
  res.json(value);
}));
settingsRouter.get('/css-snippets/:name', asyncHandler(async (req, res) => {
  const css = await readCssSnippet(req.params.name, String(req.query.vault ?? ''));
  res.setHeader('Cache-Control', 'no-cache'); res.type('text/css').send(css);
}));

settingsRouter.get('/hotkeys', asyncHandler(async (_req, res) => { res.json(await readHotkeys()); }));
settingsRouter.put('/hotkeys', asyncHandler(async (req, res) => { res.json(await patchHotkeys(req.body)); }));

settingsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json(redactSettings(await getSettings()));
  }),
);

// Patch a subset of settings. Secret fields are only overwritten when present.
settingsRouter.put(
  '/',
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const ui = body.ui === undefined ? undefined : UiSettingsSchema.partial().strict().safeParse(body.ui);
    if (ui && !ui.success) throw Object.assign(new Error(ui.error.message), { status: 400 });
    let previous = await getSettings();
    let previousRoot = previous.vault.path;
    // A changed vault.path turns the whole files API into read/write over that
    // tree, so constrain it to the allowed roots (same gate as Browse…) and
    // require it to be an existing directory before persisting.
    if (body.vault && typeof body.vault.path === 'string') {
      if (!body.vault.path.trim()) throw Object.assign(new Error('Vault path is required'), { status: 400 });
      await assertVaultPathAllowed(body.vault);
    }
    let updated = previous;
    const commit = async () => { updated = await updateSettings((d) => {
      if (body.vault) {
        Object.assign(d.vault, sanitizeVault(body.vault));
        ensureVaultBrowsable(d);
      }
      if (body.git) {
        const { token, ...rest } = body.git;
        Object.assign(d.git, rest);
        if (typeof token === 'string' && token && token !== '••••••••') d.git.token = token;
      }
      if (body.search) {
        const { chinese, ...rest } = body.search;
        Object.assign(d.search, rest);
        if (chinese) {
          Object.assign(d.search.chinese, chinese);
          if (!d.search.chinese.migration) d.search.chinese.migration = 'Native settings';
        }
      }
      if (ui?.success) Object.assign(d.ui, ui.data);
    }); };
    if (typeof body.vault?.path === 'string') {
      await withVaultMaintenance(drainFileUpdates, async () => {
        // Existing settings requests may have completed while the lease drained.
        previous = await getSettings(); previousRoot = previous.vault.path;
        if (path.resolve(body.vault.path) === path.resolve(previousRoot)) { await commit(); return; }
        try {
          await switchRuntime(commit);
          await selectVaultWorkspace(previousRoot, updated.vault.path);
        } catch (error) {
          // Restore the same persisted settings and runtime before releasing
          // the editor lease if a new folder cannot be indexed or watched.
          await switchRuntime(async () => {
            await updateSettings(draft => { Object.assign(draft, previous); });
          });
          throw error;
        }
        broadcast({ type: 'vault-changed' });
      });
    } else await commit();
    res.json(redactSettings(updated));
  }),
);

function sanitizeVault(v: any) {
  const out: any = {};
  if (typeof v.path === 'string') out.path = v.path;
  if (typeof v.trash === 'string') out.trash = v.trash;
  if (v.deleteMode === 'trash' || v.deleteMode === 'permanent') out.deleteMode = v.deleteMode;
  if (typeof v.attachmentDir === 'string') out.attachmentDir = v.attachmentDir;
  if (Array.isArray(v.allowedRoots)) {
    // allowedRoots is the gate for vault.path / Browse, so keep it well-formed:
    // only non-empty strings, normalised to absolute paths. Drops anything else
    // instead of persisting garbage (objects/numbers) that later crash path.* .
    out.allowedRoots = v.allowedRoots
      .filter((r: unknown): r is string => typeof r === 'string' && r.trim() !== '')
      .map((r: string) => path.resolve(r));
  }
  return out;
}

/** The roots a new vault path may live under — mirrors GET /browse. */
async function effectiveRoots(newAllowed?: unknown): Promise<string[]> {
  const s = await getSettings();
  const fromBody = Array.isArray(newAllowed)
    ? (newAllowed as unknown[]).filter((r): r is string => typeof r === 'string')
    : [];
  const roots = fromBody.length
    ? fromBody
    : s.vault.allowedRoots.length
      ? s.vault.allowedRoots
      : config.allowedRoots.length
        ? config.allowedRoots
        : [os.homedir()];
  return roots.map((r) => path.resolve(r));
}

export async function assertVaultPathAllowed(v: any): Promise<void> {
  const target = path.resolve(String(v.path));
  const roots = await effectiveRoots(v.allowedRoots);
  const within = roots.some((r) => target === r || target.startsWith(r + path.sep));
  if (!within) {
    throw Object.assign(new Error('Vault path is outside the allowed roots'), { status: 403 });
  }
  const st = await fs.stat(target).catch(() => null);
  if (!st || !st.isDirectory()) {
    throw Object.assign(new Error('Vault path is not an existing directory'), { status: 400 });
  }
}

/** Safe folder browser for picking a vault path, limited to allowed roots. */
settingsRouter.get(
  '/browse',
  asyncHandler(async (req, res) => {
    const s = await getSettings();
    const roots = s.vault.allowedRoots.length
      ? s.vault.allowedRoots
      : config.allowedRoots.length
        ? config.allowedRoots
        : [os.homedir()];
    const dir = req.query.dir ? path.resolve(String(req.query.dir)) : roots[0];

    const allowed = roots.some((r) => {
      const rr = path.resolve(r);
      return dir === rr || dir.startsWith(rr + path.sep);
    });
    if (!allowed) {
      res.status(403).json({ error: 'Path outside allowed roots', roots });
      return;
    }
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const folders = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => ({ name: e.name, path: path.join(dir, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json({ dir, parent: path.dirname(dir), roots, folders });
  }),
);
