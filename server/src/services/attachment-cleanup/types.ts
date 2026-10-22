import type { VaultCatalog } from '../catalog.js';

export interface CleanupOptions {
  /** Exact Vault-relative directories, including descendants. Never skips reference discovery. */
  excludeDirectories: string[];
  /** Extensions without a dot; applies to candidates only. */
  excludeExtensions: string[];
}
export interface CleanupIssue {
  path: string;
  code: string;
  message: string;
  blocking: boolean;
}
export interface Candidate {
  path: string;
  size: number;
  mtime: number;
  /** Opaque stat/content concurrency token, never supplied by the client for execution. */
  revision: string;
}
export interface CleanupPreview {
  token: string;
  expiresAt: number;
  candidates: Candidate[];
  totalBytes: number;
  protected: { path: string; reason: string }[];
  issues: CleanupIssue[];
  canExecute: boolean;
  scannedSources: number;
  options: CleanupOptions;
}
export interface CleanupResult {
  moved: { path: string; trashPath: string }[];
  failed: { path: string; message: string }[];
  stopped: string | null;
}
export interface CleanupState {
  root: string;
  /** Monotonic epoch for root, membership, contents, config, watcher events and rebuilds. */
  generation: string;
  /** Authoritative dirty/conflict/pending-write/unknown-client blockers. */
  blockers: string[];
}
export interface CleanupHost {
  getCatalog(): VaultCatalog;
  captureState(): Promise<CleanupState>;
  /** Must drain writers/updates then exclude other mutations/root changes for the callback.
   * Must coordinate editor sessions; a stub Promise callback is unsafe. */
  withExclusiveMutation<T>(work: () => Promise<T>): Promise<T>;
  /** Rechecked immediately before every move while holding the lease. */
  assertWorkspaceSafe(): Promise<void>;
  /** Optional schema-specific supplement. null falls back to conservative literal
   * discovery; explicit unresolved dynamic dependencies still block execution. */
  readPluginReferences?(pluginId: string, path: string, content: string):
    Promise<{ references: { target: string; relative: boolean }[]; issues: CleanupIssue[]; protectedExtensions?: string[] } | null>;
}
