/** Pure helpers shared by the existing search engine and native tag menus. */
export function tagName(value: string): string { return value.trim().replace(/^#+/, '').normalize('NFC'); }
export function tagKey(value: string): string { return tagName(value).toLowerCase(); }
export function validTag(value: string): boolean {
  const name = tagName(value);
  return name.length > 0 && name.length <= 256 && /[\p{L}_-]/u.test(name) &&
    /^[\p{L}\p{M}\p{N}_/-]+$/u.test(name) && !name.startsWith('/') && !name.endsWith('/') && !name.includes('//');
}
export function matchesTag(value: string, wanted: string, descendants = true): boolean {
  const key = tagKey(value), target = tagKey(wanted);
  return key === target || (descendants && key.startsWith(target + '/'));
}
export function normalizeStoredTags(value: unknown): string[] {
  const strings = typeof value === 'string' ? [value] : Array.isArray(value) || value instanceof Set ? [...value] : [];
  return [...new Set(strings.filter((v): v is string => typeof v === 'string')
    .flatMap((v) => v.split(/[,，\s]+/u)).filter(validTag).map(tagName))];
}
export function tagPageAliases(value: string): string[] {
  return value.split(/\s*,\s*/).filter((v) => v.trim().startsWith('#') && validTag(v)).map(tagName);
}
export function parseTagFilters(query: string): { text: string; include: string[]; exclude: string[] } {
  const include: string[] = [], exclude: string[] = [];
  const text = query.replace(/(^|\s)(-?)tags?:#?([^\s]+)/gi, (whole, space: string, negative: string, value: string) => {
    if (!validTag(value)) return whole;
    (negative ? exclude : include).push(tagName(value));
    return space;
  }).trim();
  return { text, include, exclude };
}
export function matchesTagFilters(tags: readonly string[], filters: { include: string[]; exclude: string[] }): boolean {
  return filters.include.every((tag) => tags.some((value) => matchesTag(value, tag))) &&
    filters.exclude.every((tag) => !tags.some((value) => matchesTag(value, tag)));
}
export function withTagFilter(query: string, tag: string, mode: 'new' | 'include' | 'exclude'): string {
  if (!validTag(tag)) throw new Error('Invalid tag');
  if (mode === 'new') return `tag:#${tagName(tag)}`;
  // Replace the opposite filter for this exact tag; retain unrelated text verbatim.
  const rest = query.replace(/(^|\s)(-?)tags?:#?([^\s]+)/gi, (whole, space: string, _neg: string, value: string) =>
    tagKey(value) === tagKey(tag) ? space : whole).trim();
  return `${rest}${rest ? ' ' : ''}${mode === 'exclude' ? '-' : ''}tag:#${tagName(tag)}`;
}
