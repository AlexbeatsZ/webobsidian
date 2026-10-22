import { createHash } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { COOKIE_NAME, requireAuth } from '../middleware/auth.js';
import { AttachmentCleanupService } from '../services/attachment-cleanup/service.js';

const optionsSchema = z.object({
  excludeDirectories: z.array(z.string().max(2048)).max(200).default([]),
  excludeExtensions: z.array(z.string().max(32)).max(200).default([]),
}).strict();
const executeSchema = z.object({
  token: z.string().uuid(), paths: z.array(z.string().min(1).max(2048)).min(1).max(10_000),
  confirm: z.literal(true),
}).strict();

/** Mount once at /api/attachments after the coordinator supplies the real mutation lease. */
export function createAttachmentsRouter(service: AttachmentCleanupService) {
  const router = Router();
  router.use(requireAuth);
  // Bind a random preview to the authenticated session without retaining credentials.
  const owner = (req: Parameters<typeof requireAuth>[0]) => createHash('sha256')
    .update(String(req.cookies?.[COOKIE_NAME] || req.headers.authorization || '')).digest('base64url');
  router.post('/scan', asyncHandler(async (req, res) => {
    const parsed = optionsSchema.safeParse(req.body ?? {});
    if (!parsed.success) { res.status(400).json({ error: '附件扫描排除配置无效' }); return; }
    res.json(await service.preview(parsed.data, owner(req)));
  }));
  router.post('/execute', asyncHandler(async (req, res) => {
    const parsed = executeSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: '需要有效扫描令牌、选中路径及明确确认' }); return; }
    res.json(await service.execute(parsed.data.token, parsed.data.paths, owner(req)));
  }));
  return router;
}
