export interface PdfBox { x: number; y: number; width: number; height: number }
export interface PdfMatch {
  id: string; page: number; from: number; to: number; boxes: readonly PdfBox[];
}
export interface PdfOutlineEntry {
  title: string; page: number | null; children: PdfOutlineEntry[];
}
export interface PdfSnapshot {
  path: string;
  status: 'loading' | 'ready' | 'error' | 'destroyed';
  pageCount: number;
  currentPage: number;
  navigation: number;
  outline: readonly PdfOutlineEntry[];
  outlineError: string;
  query: string;
  matches: readonly PdfMatch[];
  matchesByPage: Readonly<Record<number, readonly PdfMatch[]>>;
  activeMatch: number;
  searchPending: boolean;
  searchedPages: number;
  truncated: boolean;
  error: string;
}
