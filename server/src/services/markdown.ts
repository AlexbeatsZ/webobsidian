import matter from 'gray-matter';
import path from 'node:path';
import { analyzeMarkdown, contentTargets, extractMetadata, isGlobalContentTarget, parseLinkTarget } from '@webobsidian/markdown-core';
import { normalizeStoredTags } from '@webobsidian/search-core';

export interface ParsedNote {
  title: string;
  frontmatter: Record<string, unknown>;
  body: string;
  tags: string[];
  /** Wikilink targets (without alias / heading). */
  links: string[];
  headings: string[];
  contentTargets: ReturnType<typeof contentTargets>;
}

/** Parse a markdown document into structured fields used for search & links. */
export function parseNote(rel: string, raw: string): ParsedNote {
  let frontmatter: Record<string, unknown> = {};
  let body = raw;
  try {
    const fm = matter(raw);
    frontmatter = (fm.data ?? {}) as Record<string, unknown>;
    body = fm.content;
  } catch {
    /* malformed frontmatter — index raw */
  }

  const model = analyzeMarkdown(raw.replace(/^\ufeff/, '').replace(/\r\n|\r/g, '\n'));
  const metadata = extractMetadata(model);
  const links = new Set(metadata.links);
  const tags = new Set(metadata.tags);
  for (const [key, value] of Object.entries(frontmatter))
    if (/^tags?$/i.test(key)) for (const tag of normalizeStoredTags(value)) tags.add(tag);

  const headings = metadata.headings.map((heading) => heading.text);

  const fmTitle = typeof frontmatter.title === 'string' ? frontmatter.title : undefined;
  const title = fmTitle || path.basename(rel).replace(/\.(md|markdown)$/i, '');

  return { title, frontmatter, body, tags: [...tags], links: [...links], headings, contentTargets: contentTargets(model) };
}

/** Normalize a wikilink target to a comparable key (basename, no ext, lower). */
export function linkKey(target: string): string {
  const parsed = parseLinkTarget(target);
  if (isGlobalContentTarget(target)) return parsed.fragment;
  const base = parsed.path;
  return base.replace(/\.(md|markdown)$/i, '').toLowerCase();
}
