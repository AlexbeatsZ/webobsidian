import { z } from 'zod';

export const documentAppearance = {
  fontTextSize: { default: 18, min: 12, max: 36 },
  fileLineWidth: { default: 700, min: 320, max: 2000 },
} as const;

export const UiSettingsSchema = z.object({
  theme: z.enum(['obsidian-dark', 'obsidian-light']).default('obsidian-light'),
  defaultView: z.enum(['live', 'source', 'reading']).default('live'),
  debugRecording: z.boolean().default(false),
  debugSource: z.boolean().default(true),
  fontTextSize: z.number().int().min(documentAppearance.fontTextSize.min).max(documentAppearance.fontTextSize.max)
    .default(documentAppearance.fontTextSize.default),
  fileLineWidth: z.number().int().min(documentAppearance.fileLineWidth.min).max(documentAppearance.fileLineWidth.max)
    .default(documentAppearance.fileLineWidth.default),
});

export type UiSettings = z.infer<typeof UiSettingsSchema>;
export const defaultUiSettings = UiSettingsSchema.parse({});
