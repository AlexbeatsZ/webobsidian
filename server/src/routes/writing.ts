import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth } from '../middleware/auth.js';
import { writingSettings, saveWritingSettings } from '../services/writing.js';
import { MathConfigurationSchema, saveMathConfiguration } from '../services/mathSettings.js';
export const writingRouter = Router();
writingRouter.use(requireAuth);
writingRouter.get(
  '/',
  asyncHandler(async (_req, res) => res.json(await writingSettings())),
);
writingRouter.put(
  '/',
  asyncHandler(async (req, res) => {
    if (req.body.math !== undefined) {
      const input = z.object({ math: MathConfigurationSchema, mathSource: z.object({
        path: z.literal('math.jsonc'), content: z.string(), exists: z.boolean(), revision: z.string().optional(), vault: z.string(),
      }) }).strict().parse(req.body);
      await saveMathConfiguration(input.mathSource, input.math);
      res.json(await writingSettings());
      return;
    }
    const patch = z
      .object({
        latex: z.record(z.unknown()).optional(),
        linter: z.record(z.unknown()).optional(),
        hotkeys: z.record(z.array(z.object({ modifiers: z.array(z.string()), key: z.string() }))).optional(),
      })
      .parse(req.body);
    await saveWritingSettings(patch);
    res.json(await writingSettings());
  }),
);
