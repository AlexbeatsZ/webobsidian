import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { nativeFeatureSettings, patchNativeFeatureSettings } from '../services/nativeFeatureSettings.js';
import { AutomationSchema, readAutomationConfiguration, saveAutomationConfiguration, importAutomationConfiguration } from '../services/automationSettings.js';
import { promises as fs } from 'node:fs';
import { readFileSnapshot, resolveInVault } from '../services/vaultFile.js';
import { broadcast } from '../services/realtime.js';
import { readBlockEffects } from '../services/blockEffects.js';

export const nativeFeaturesRouter = Router();
nativeFeaturesRouter.get('/blocks', asyncHandler(async (_req, res) => { res.json(await readBlockEffects()); }));
const configSource = z.object({ path: z.literal('automation.jsonc'), content: z.string().max(1024 * 1024),
  exists: z.boolean(), revision: z.string().optional(), vault: z.string().min(1) }).strict();
nativeFeaturesRouter.get('/automation', asyncHandler(async (_req, res) => { res.json(await readAutomationConfiguration()); }));
nativeFeaturesRouter.put('/automation', asyncHandler(async (req, res) => {
  const input = z.object({ source: configSource, settings: AutomationSchema }).strict().safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: input.error.issues.map(issue => issue.path.join('.') + ': ' + issue.message).join('; ') }); return; }
  const value = await saveAutomationConfiguration(input.data);
  broadcast({ type: 'automation-changed' }); res.json(value);
}));
nativeFeaturesRouter.post('/automation/import', asyncHandler(async (req, res) => {
  const input = configSource.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: 'Invalid configuration snapshot' }); return; }
  const value = await importAutomationConfiguration(input.data);
  broadcast({ type: 'automation-changed' }); res.json(value);
}));
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
