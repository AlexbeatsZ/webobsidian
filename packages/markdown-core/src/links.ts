export interface LinkTarget { path: string; fragment: string; alias: string | null }
export interface ResolvedTarget extends LinkTarget {
  status: 'resolved' | 'missing' | 'ambiguous' | 'external' | 'denied';
  candidates: string[];
}

export function parseLinkTarget(raw: string): LinkTarget {
  const aliasAt = raw.search(/(?<!\\)\|/);
  const destination = (aliasAt < 0 ? raw : raw.slice(0, aliasAt)).trim();
  const hashAt = destination.indexOf('#');
  return {
    path: (hashAt < 0 ? destination : destination.slice(0, hashAt)).replace(/\\\|/g, '|').trim(),
    fragment: hashAt < 0 ? '' : destination.slice(hashAt + 1),
    alias: aliasAt < 0 ? null : raw.slice(aliasAt + 1).replace(/\\\|/g, '|'),
  };
}

const keyOf = (value: string) => value.normalize('NFC').toLocaleLowerCase('en-US');
function normalizePath(value: string): string | null {
  const parts: string[] = [];
  for (const part of value.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!parts.length) return null; parts.pop(); }
    else parts.push(part);
  }
  return parts.join('/');
}

export function resolveTarget(raw: string, sourcePath: string, files: readonly string[]): ResolvedTarget {
  const target = parseLinkTarget(raw);
  const result = (status: ResolvedTarget['status'], path = target.path, candidates: string[] = []): ResolvedTarget =>
    ({ ...target, path, status, candidates });
  if (/^(?:https?|mailto):/i.test(target.path)) return result('external');
  if (/^[a-z][a-z\d+.-]*:/i.test(target.path) || target.path.includes('\0')) return result('denied');
  if (!target.path) return result('resolved', sourcePath);
  const folder = sourcePath.split('/').slice(0, -1).join('/');
  const explicitRelative = /^\.\.?\//.test(target.path);
  let decoded = target.path;
  try { decoded = decodeURIComponent(decoded); } catch { /* literal percent is a valid filename */ }
  const normalized = normalizePath(explicitRelative ? `${folder}/${decoded}` : decoded);
  if (normalized === null) return result('denied');
  const extension = /\.[^/]+$/.test(normalized);
  const candidates = files.filter((file) => extension || /\.(md|markdown)$/i.test(file));
  const names = extension ? [normalized] : [normalized + '.md', normalized + '.markdown'];
  const match = (names: string[]) => candidates.filter((file) => names.some((name) => keyOf(file) === keyOf(name)));
  let found = match(names);
  if (!found.length && !explicitRelative && !target.path.startsWith('/')) found = match(names.map((name) => folder ? `${folder}/${name}` : name));
  if (!found.length && !explicitRelative && !target.path.startsWith('/')) {
    found = candidates.filter((file) => names.some((name) => keyOf(file).endsWith('/' + keyOf(name))));
  }
  if (found.length === 1) return result('resolved', found[0], found);
  return result(found.length ? 'ambiguous' : 'missing', normalized, found.sort());
}
