import { z } from 'zod';

export const FileSyncPreferencesSchema = z.object({
  enabled: z.boolean().default(false),
  endpoints: z.array(z.string().trim().min(1).max(2048)).max(16).default([]),
  token: z.string().max(512).default(''),
  intervalSec: z.number().int().min(5).max(3600).default(15),
});
export type FileSyncPreferences = z.infer<typeof FileSyncPreferencesSchema>;
export type SyncEntry = { hash: string | null; version: number };
export type SyncManifest = { workspaceId: string; revision: number; files: Record<string, SyncEntry> };
export type SyncChange = { path: string; hash: string | null; expectedVersion: number };
export type SyncOperation = { workspaceId: string; deviceId: string; operationId: string; changes: SyncChange[] };
export type FileSyncStatus = {
  enabled: boolean; endpoints: string[]; hasToken: boolean; activeEndpoint: string | null;
  phase: 'disabled' | 'idle' | 'syncing' | 'error' | 'conflict' | 'recovery';
  message: string; lastSuccess: string | null; conflictDirectory: string | null; conflictBranches: string[];
};
