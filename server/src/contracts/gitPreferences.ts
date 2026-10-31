import { z } from 'zod';

export const GitPreferencesSchema = z.object({
  enabled: z.boolean().default(false),
  remote: z.string().trim().max(4096).default(''),
  branch: z.string().trim().min(1).max(240).default('main'),
  token: z.string().max(2048).default(''),
  authorName: z.string().max(240).default('WebObsidian'),
  authorEmail: z.string().max(320).default('webobsidian@localhost'),
  autoSync: z.boolean().default(false),
  autoCommitOnSave: z.boolean().default(false),
  intervalSec: z.number().int().min(60).max(86400).default(300),
  lfsPatterns: z.array(z.string().min(1).max(2048)).max(256)
    .default(['*.png', '*.jpg', '*.jpeg', '*.gif', '*.pdf', '*.mp4', '*.mov', '*.zip']),
});
export type GitPreferences = z.infer<typeof GitPreferencesSchema>;
