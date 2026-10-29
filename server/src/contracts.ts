export function isReadOnlyAdapterOperation(operation: unknown): boolean {
  return typeof operation === 'string' && ['read', 'readBinary', 'exists', 'stat', 'list'].includes(operation);
}

export interface VaultConfigurationSource {
  path: string; content: string; exists: boolean; revision?: string; vault: string;
}

export interface PropertyTypeExpectation {
  vault: string; revision?: string; exists: boolean; previous: string | null;
}

export interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  ext?: string;
  size?: number;
  mtime?: number;
  ctime?: number;
  children?: TreeNode[];
}

export interface SearchHit {
  path: string;
  title: string;
  score: number;
  tags: string[];
  snippet: string;
  matchedField?: string;
  matchKind?: 'literal' | 'pinyin';
}

export interface MatchContext {
  text: string;
  source?: { from: number; to: number; text: string };
  ranges: [number, number][];
  pre: boolean;
  post: boolean;
}

export interface NoteMatches {
  path: string;
  count: number;
  sourceRanges?: { from: number; to: number; text: string }[];
  contexts: MatchContext[];
}

export type FileUpdateResult = { status: 'indexed'; path: string } |
  { status: 'failed'; path: string; error: string } |
  { status: 'skipped'; path: string; reason: 'disabled' | 'ignored' };

export interface McpSelection {
  kind: 'source' | 'rendered';
  text: string;
  from?: { line: number; ch: number };
  to?: { line: number; ch: number };
}

export interface McpContextItem {
  id: string;
  kind: 'page' | 'selection';
  path: string;
  pinned: boolean;
  createdAt: string;
  revision?: string;
  selections?: McpSelection[];
}
