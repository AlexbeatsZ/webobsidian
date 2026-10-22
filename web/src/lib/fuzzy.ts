import { matchText, matchPath, prepareQuery, type PreparedQuery } from '@webobsidian/search-core';
import { searchSettings } from './search';
export { prepareQuery, type PreparedQuery };
export interface FuzzyMatch {
  score: number;
  matches: [number, number][];
}
export const fuzzySearch = (query: PreparedQuery, text: string): FuzzyMatch | null =>
  matchText(query.query, text, searchSettings());
export const fuzzySearchPath = (query: PreparedQuery, path: string): FuzzyMatch | null =>
  matchPath(query.query, path, searchSettings());
