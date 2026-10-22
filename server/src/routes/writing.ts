import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth } from '../middleware/auth.js';
import { writingSettings, saveWritingSettings } from '../services/writing.js';
export const writingRouter = Router();
writingRouter.use(requireAuth);
writingRouter.get(
  '/',
  asyncHandler(async (_req, res) => res.json(await writingSettings())),
);
writingRouter.put(
  '/',
  asyncHandler(async (req, res) => {
    const patch = z
      .object({
        latex: z.record(z.unknown()).optional(),
        linter: z.record(z.unknown()).optional(),
        hotkeys: z.record(z.array(z.object({ modifiers: z.array(z.string()), key: z.string() }))).optional(),
      })
      .parse(req.body);
    res.json(await saveWritingSettings(patch));
  }),
);
