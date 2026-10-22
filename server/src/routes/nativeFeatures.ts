import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';
import { nativeFeatureSettings, patchNativeFeatureSettings } from '../services/nativeFeatureSettings.js';

export const nativeFeaturesRouter = Router();
nativeFeaturesRouter.use(requireAuth);
nativeFeaturesRouter.get('/', asyncHandler(async (_req, res) => { res.json(await nativeFeatureSettings()); }));
nativeFeaturesRouter.put('/', asyncHandler(async (req, res) => {
  const input = z.object({ vault: z.string().min(1), tags: z.object({ batchEnabled: z.boolean().optional(),
    wranglerEnabled: z.boolean().optional() }).strict().optional(),
    attachments: z.object({ excludeDirectories: z.array(z.string().max(4096)).max(256),
      excludeExtensions: z.array(z.string().max(100)).max(256) }).strict().optional(),
  }).strict().safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: 'Invalid native feature settings' }); return; }
  res.json(await patchNativeFeatureSettings(input.data));
}));
