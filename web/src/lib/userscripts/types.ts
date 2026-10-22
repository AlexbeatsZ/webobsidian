/** Wire types only; native code is never imported into the SPA. */
export type RunAt = 'document-start' | 'document-body' | 'document-end' | 'document-idle';
export interface ScriptMetadata {
  name: string; namespace: string; version: string; description: string;
  matches: string[]; includes: string[]; excludes: string[]; excludeMatches: string[];
  grants: string[]; connects: string[]; requires: string[];
  resources: { name: string; url: string }[];
  runAt: RunAt; noframes: boolean; raw: Record<string, string[]>;
}
export interface ScriptAsset { url: string; source: string; dataUrl?: string }
export interface ScriptBundle {
  source: string; metadata: ScriptMetadata; requires: ScriptAsset[];
  resources: Record<string, ScriptAsset>; warnings: string[];
}
export interface ScriptRecord extends ScriptBundle {
  id: string; revision: number; enabled: boolean; importedAt: number; updatedAt: number;
  sourceUrl?: string; autoUpdate: boolean;
  approved: { grants: string[]; connects: string[]; pageWorld: boolean;
    rules: Pick<ScriptMetadata, 'matches' | 'includes' | 'excludes' | 'excludeMatches'> };
  update: { checkedAt?: number; state: string; error?: string; availableVersion?: string;
    validators?: Record<string, { etag?: string; modified?: string }>; pending?: ScriptBundle; pendingSourceUrl?: string; candidateId?: string };
}
export interface ScriptSnapshot {
  scripts: ScriptRecord[]; migration: string; autoUpdate: boolean; intervalHours: number;
  vault: string; statuses: GuestStatus[];
}
export interface GuestStatus {
  guestId: number; url: string; scriptId?: string; state: string; message?: string; at: number;
}
export interface ScriptMenu { guestId: number; scriptId: string; id: string; label: string; url: string }
export interface UserscriptBridge {
  request(action: string, payload?: unknown): Promise<any>;
  subscribe(listener: () => void): () => void;
}
