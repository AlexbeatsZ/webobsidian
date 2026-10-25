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
  contexts: MatchContext[];
}

export type FileUpdateResult = { status: 'indexed'; path: string } |
  { status: 'failed'; path: string; error: string } |
  { status: 'skipped'; path: string; reason: 'disabled' | 'ignored' };
