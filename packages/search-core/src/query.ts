/** Shared query syntax for the file picker, body search and tag actions. */
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
  return value.split(/\s*,\s*/).filter(v => v.trim().startsWith('#') && validTag(v)).map(tagName);
}
// Quoted tokens remain literal; a hash inside a word is not an operator.
const queryTokens = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\S+/g;
function tagFilter(token: string) {
  const match = /^(-?)(?:tags?:#?|#)(.+)$/i.exec(token);
  return match && validTag(match[2]) ? { negative: !!match[1], value: tagName(match[2]) } : undefined;
}
export function parseTagFilters(query: string): { text: string; include: string[]; exclude: string[] } {
  const include: string[] = [], exclude: string[] = [];
  const text = query.replace(queryTokens, token => {
    const filter = tagFilter(token);
    if (!filter) return token;
    (filter.negative ? exclude : include).push(filter.value);
    return '';
  }).trim();
  return { text, include, exclude };
}
export function matchesTagFilters(tags: readonly string[], filters: { include: string[]; exclude: string[] }): boolean {
  return filters.include.every(tag => tags.some(value => matchesTag(value, tag))) &&
    filters.exclude.every(tag => !tags.some(value => matchesTag(value, tag)));
}
export function withTagFilter(query: string, tag: string, mode: 'new' | 'include' | 'exclude'): string {
  if (!validTag(tag)) throw new Error('Invalid tag');
  if (mode === 'new') return `#${tagName(tag)}`;
  const rest = query.replace(queryTokens, token => {
    const filter = tagFilter(token);
    return filter && tagKey(filter.value) === tagKey(tag) ? '' : token;
  }).trim();
  return `${rest}${rest ? ' ' : ''}${mode === 'exclude' ? '-' : ''}#${tagName(tag)}`;
}
/** Existing field qualifiers share one parser; engines retain their own fields. */
export function parseSearchQuery(query: string) {
  const filters = parseTagFilters(query);
  const fieldMap: Record<string, string> = { title: 'title', path: 'path', heading: 'headings', body: 'body' };
  const fields = new Set<string>();
  const filterText = filters.text.replace(queryTokens, token => {
    const match = /^(title|path|heading|body):(.+)$/i.exec(token);
    if (!match) return token.replace(/^(["'])(.*)\1$/, '$2');
    fields.add(fieldMap[match[1].toLowerCase()]);
    return match[2];
  }).trim();
  return { ...filters, filterText, fields: [...fields] };
}
/** Hash belongs to query filters and link fragments, never a new file title. */
export function fileTitleError(path: string): string | undefined {
  return path.replaceAll('\\', '/').split('/').at(-1)?.includes('#')
    ? '文件标题不能包含 #；请在搜索中用 #标签 筛选。'
    : undefined;
}
