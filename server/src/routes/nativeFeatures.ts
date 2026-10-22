import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';
import { nativeFeatureSettings, patchNativeFeatureSettings } from '../services/nativeFeatureSettings.js';
import { promises as fs } from 'node:fs';
import { readFileSnapshot, resolveInVault } from '../services/vault.js';
import { broadcast } from '../services/realtime.js';

export const nativeFeaturesRouter = Router();
nativeFeaturesRouter.use(requireAuth);
nativeFeaturesRouter.get('/', asyncHandler(async (_req, res) => { res.json(await nativeFeatureSettings()); }));
nativeFeaturesRouter.get('/folder-tags/import', asyncHandler(async (req, res) => {
  const before = await nativeFeatureSettings();
  if (req.query.vault !== before.vault) { res.status(409).json({ error: 'Vault changed; reopen settings' }); return; }
  const path = '@管理/按文件夹补标签配置.md';
  const stat = await fs.stat(await resolveInVault(path));
  if (stat.size > 1024 * 1024) { res.status(413).json({ error: '旧规则笔记超过 1 MiB' }); return; }
  const { content } = await readFileSnapshot(path);
  if ((await nativeFeatureSettings()).vault !== before.vault) { res.status(409).json({ error: 'Vault changed during import' }); return; }
  res.json({ content });
}));
nativeFeaturesRouter.put('/', asyncHandler(async (req, res) => {
  const input = z.object({ vault: z.string().min(1), tags: z.object({ batchEnabled: z.boolean().optional(),
    wranglerEnabled: z.boolean().optional(), folderTags: z.object({ enabled: z.boolean(), pruneAncestors: z.boolean(),
      rules: z.array(z.object({ folder: z.string().max(4096), tags: z.array(z.string().max(256)).min(1).max(128), recursive: z.boolean() }).strict()).max(256),
    }).strict().optional() }).strict().optional(),
    attachments: z.object({ excludeDirectories: z.array(z.string().max(4096)).max(256),
      excludeExtensions: z.array(z.string().max(100)).max(256) }).strict().optional(),
  }).strict().safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: 'Invalid native feature settings' }); return; }
  const settings = await patchNativeFeatureSettings(input.data);
  broadcast({ type: 'native-features-changed' });
  res.json(settings);
}));
