import { Router } from 'express';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth } from '../middleware/auth.js';
import * as plugins from '../services/plugins.js';

export const pluginsRouter = Router();
pluginsRouter.use(requireAuth);

pluginsRouter.get('/', asyncHandler(async (_req, res) => res.json({ plugins: await plugins.listInstalled() })));

pluginsRouter.post('/adapter', asyncHandler(async (req, res) => {
  if(typeof req.body?.path !== 'string' || typeof req.body?.op !== 'string') { res.status(400).json({ error: 'path and op required' }); return; }
  res.json(await plugins.adapterOperation(req.body.op, req.body.path, req.body));
}));
pluginsRouter.post('/request', asyncHandler(async (req, res) => {
  const options = req.body ?? {}; const url = new URL(options.url);
  if (!['http:', 'https:'].includes(url.protocol)) { res.status(400).json({error:'HTTP(S) URL required'}); return; }
  const response = await fetch(url,{method:options.method ?? 'GET',headers:options.headers,body:options.body,signal:AbortSignal.timeout(30000)});
  const bytes = Buffer.from(await response.arrayBuffer());
  res.json({status:response.status,headers:Object.fromEntries(response.headers),base64:bytes.toString('base64')});
}));
pluginsRouter.get('/:id/data', asyncHandler(async (req, res) => res.json({ data: await plugins.readPluginData(req.params.id) })));
pluginsRouter.put('/:id/data', asyncHandler(async (req, res) => {
  await plugins.writePluginData(req.params.id, req.body?.data ?? null); res.json({ ok: true });
}));

pluginsRouter.post(
  '/install',
  asyncHandler(async (req, res) => {
    const repo = String(req.body?.repo ?? '');
    if (!repo) {
      res.status(400).json({ error: 'repo required (owner/name)' });
      return;
    }
    res.json({ plugin: await plugins.installFromGithub(repo) });
  }),
);

pluginsRouter.patch(
  '/:id/enabled',
  asyncHandler(async (req, res) => {
    await plugins.setEnabled(req.params.id, Boolean(req.body?.enabled));
    res.json({ ok: true });
  }),
);

// Serve plugin assets to the browser loader.
pluginsRouter.get(
  '/:id/:asset',
  asyncHandler(async (req, res) => {
    const asset = req.params.asset;
    if (!['main.js', 'styles.css', 'manifest.json'].includes(asset)) {
      res.status(400).json({ error: 'invalid asset' });
      return;
    }
    const body = await plugins.getPluginAsset(req.params.id, asset as any);
    const type =
      asset === 'main.js'
        ? 'application/javascript'
        : asset === 'styles.css'
          ? 'text/css'
          : 'application/json';
    res.setHeader('Content-Type', type).send(body);
  }),
);
