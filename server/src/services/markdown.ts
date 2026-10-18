import matter from 'gray-matter';
import path from 'node:path';
import { extractMetadata, parseLinkTarget } from '@webobsidian/markdown-core';

export interface ParsedNote {
  title: string;
  frontmatter: Record<string, unknown>;
  body: string;
  tags: string[];
  /** Wikilink targets (without alias / heading). */
  links: string[];
  headings: string[];
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

  const metadata = extractMetadata(raw.replace(/^\ufeff/, '').replace(/\r\n|\r/g, '\n'));
  const links = new Set(metadata.links);
  const tags = new Set(metadata.tags);
  const fmTags = frontmatter.tags;
  if (Array.isArray(fmTags)) for (const t of fmTags) tags.add(String(t));
  else if (typeof fmTags === 'string') for (const t of fmTags.split(/[,\s]+/)) if (t) tags.add(t);

  const headings = metadata.headings.map((heading) => heading.text);

  const fmTitle = typeof frontmatter.title === 'string' ? frontmatter.title : undefined;
  const title = fmTitle || path.basename(rel).replace(/\.(md|markdown)$/i, '');

  return { title, frontmatter, body, tags: [...tags], links: [...links], headings };
}

/** Normalize a wikilink target to a comparable key (basename, no ext, lower). */
export function linkKey(target: string): string {
  const base = parseLinkTarget(target).path;
  return base.replace(/\.(md|markdown)$/i, '').toLowerCase();
}
