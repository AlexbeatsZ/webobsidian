import type { SourceChange } from '@webobsidian/markdown-core';

export type TagOperation =
  | { kind: 'add'; tags: string[] }
  | { kind: 'remove'; tags: string[]; descendants?: boolean }
  | { kind: 'rename'; from: string; to: string; descendants?: boolean };
export type TagScope = { kind: 'vault' } | { kind: 'folder'; path: string } | { kind: 'files'; paths: string[] };
export interface TagOverlay { path: string; raw: string; revision?: string; version: number }
export interface TagSummary { tag: string; count: number; directCount: number; pages: string[] }
export interface TagCollision { from: string; to: string }
export interface TagFilePreview {
  path: string;
  status: 'ready' | 'unchanged' | 'skipped';
  reason?: string;
  revision?: string;
  version?: number;
  local: boolean;
  changes: SourceChange[];
  expected: string[];
}
export interface TagPreview {
  id: string;
  expiresAt: number;
  operation: TagOperation;
  files: TagFilePreview[];
  collisions: TagCollision[];
}
export interface TagPreviewRequest { operation: TagOperation; scope: TagScope; overlays?: TagOverlay[] }
export interface TagApplyResult { path: string; status: 'written' | 'local'; revision?: string }
export interface TagPreferences { batchEnabled: boolean; wranglerEnabled: boolean; migration?: string }
