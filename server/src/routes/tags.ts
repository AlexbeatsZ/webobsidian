import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { nativeTags } from '../services/tags/service.js';

const tag = z.string().min(1).max(260);
const relative = z.string().max(4096).refine((p) => !p.includes('\\') && !p.startsWith('/') &&
  p.split('/').every((part) => part !== '..' && part !== '.' && !part.startsWith('.')), 'Invalid visible Vault path');
const operation = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('folder-rules') }),
  z.object({ kind: z.literal('add'), tags: z.array(tag).min(1).max(128) }),
  z.object({ kind: z.literal('remove'), tags: z.array(tag).min(1).max(128), descendants: z.boolean().optional() }),
  z.object({ kind: z.literal('rename'), from: tag, to: tag, descendants: z.boolean().optional() }),
]);
const scope = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('vault') }),
  z.object({ kind: z.literal('folder'), path: relative }),
  z.object({ kind: z.literal('files'), paths: z.array(relative).max(50_000) }),
]);
const preview = z.object({ operation, scope, overlays: z.array(z.object({ path: relative,
  raw: z.string().max(8_000_000), revision: z.string().optional(), version: z.number().int().nonnegative() })).max(256).optional() });
const apply = z.object({ id: z.string().uuid(), path: relative, confirmMerge: z.boolean().default(false), local: z.boolean().optional() });
const parse = <T>(schema: z.ZodType<T>, input: unknown): T => {
  const result = schema.safeParse(input);
  if (!result.success) throw Object.assign(new Error(result.error.issues.map((issue) => issue.message).join('; ')), { status: 400 });
  return result.data;
};

/** Mount once at /api/tags; same session authentication as existing files/search. */
export const tagsRouter = Router();
tagsRouter.get('/', asyncHandler(async (_req, res) => { res.json(await nativeTags.summary()); }));
tagsRouter.get('/page', asyncHandler(async (req, res) => { res.json(await nativeTags.page(parse(tag, req.query.tag))); }));
tagsRouter.post('/page', asyncHandler(async (req, res) => {
  const body = parse(z.object({ tag, path: relative.refine((p) => p.length > 0, 'path required') }), req.body);
  res.json(await nativeTags.createPage(body.tag, body.path));
}));
tagsRouter.post('/preview', asyncHandler(async (req, res) => { res.json(await nativeTags.preview(parse(preview, req.body))); }));
tagsRouter.post('/apply', asyncHandler(async (req, res) => {
  const body = parse(apply, req.body);
  res.json(await nativeTags.apply(body.id, body.path, Boolean(body.confirmMerge), body.local));
}));
tagsRouter.post('/cancel', asyncHandler(async (req, res) => {
  const body = parse(z.object({ id: z.string().uuid() }), req.body);
  nativeTags.cancel(body.id);
  res.json({ ok: true });
}));
