import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { readConfiguredMenu, writeConfiguredMenu } from '../services/configuredMenus.js';

export const configuredMenusRouter = Router();
configuredMenusRouter.get('/config', asyncHandler(async (req, res) => {
  const input = z.object({ path: z.string().max(240).default('menu.jsonc'), vault: z.string().max(100).optional() }).parse(req.query);
  res.setHeader('Cache-Control', 'no-store');
  res.json(await readConfiguredMenu(input.path, input.vault));
}));
configuredMenusRouter.put('/config', asyncHandler(async (req, res) => {
  const input = z.object({ path: z.string().max(240), content: z.string().max(1024 * 1024), vault: z.string().min(1).max(100), exists: z.boolean(), revision: z.string().max(100).optional() }).strict().parse(req.body);
  res.json(await writeConfiguredMenu(input));
}));
