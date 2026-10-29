import { Router } from 'express';
import { asyncHandler } from '../middleware/error.js';
import { fileSyncEngine, fileSyncPreferences, runFileSync, saveFileSyncPreferences } from '../services/fileSync.js';

export const fileSyncRouter = Router();
fileSyncRouter.get('/', asyncHandler(async (_request, response) => {
  const preferences = await fileSyncPreferences();
  response.setHeader('Cache-Control', 'no-store');
  response.json({ preferences: { ...preferences, token: preferences.token ? '••••••••' : '' }, status: (await fileSyncEngine()).status() });
}));
fileSyncRouter.put('/', asyncHandler(async (request, response) => {
  await saveFileSyncPreferences(request.body); response.json({ ok: true });
}));
fileSyncRouter.post('/run', asyncHandler(async (_request, response) => { response.json(await runFileSync()); }));
fileSyncRouter.post('/resolve', asyncHandler(async (request, response) => {
  if (!['local', 'remote', 'recheck'].includes(request.body?.choice)) throw Object.assign(new Error('请选择需要保留的版本'), { status: 400 });
  response.json(await (await fileSyncEngine()).resolveConflict(request.body.choice));
}));
