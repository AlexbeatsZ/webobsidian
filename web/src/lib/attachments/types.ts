export interface CleanupOptions { excludeDirectories: string[]; excludeExtensions: string[] }
export interface CleanupPreview {
  token: string; expiresAt: number;
  candidates: { path: string; size: number; mtime: number; revision: string }[];
  totalBytes: number;
  protected: { path: string; reason: string }[];
  issues: { path: string; code: string; message: string; blocking: boolean }[];
  canExecute: boolean; scannedSources: number; options: CleanupOptions;
}
export interface CleanupResult {
  moved: { path: string; trashPath: string }[];
  failed: { path: string; message: string }[];
  stopped: string | null;
}
/** Inject the existing authenticated request wrapper; no second fetch/error stack. */
export type CleanupRequest = <T>(url: string, options?: RequestInit) => Promise<T>;
export interface CleanupDialogHost {
  request: CleanupRequest;
  /** All DocumentRegistry sessions + Canvas buffers, conflicts and pending writes. */
  getBlockers(): string[];
  subscribeSafety(changed: () => void): () => void;
  openTrash(): void;
  /** Existing tree refresh after a partial/successful operation; index/fs uses existing events. */
  refreshFiles(): Promise<unknown>;
  /** Optional native persisted exclusions. Never overwrite or discard user exclusions. */
  initialOptions?: CleanupOptions;
  /** Read current Vault-specific exclusions before opening; prevents async startup defaults
   * from discarding an existing user's exclusions. Failure must block scanning. */
  loadOptions?(): Promise<CleanupOptions>;
  saveOptions?(options: CleanupOptions): Promise<void>;
}
