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

function prepareTarget(raw: string, sourcePath: string) {
  const target = parseLinkTarget(raw);
  const result = (status: ResolvedTarget['status'], path = target.path, candidates: string[] = []): ResolvedTarget =>
    ({ ...target, path, status, candidates });
  if (/^(?:https?|mailto):/i.test(target.path)) return { terminal: result('external') };
  if (/^[a-z][a-z\d+.-]*:/i.test(target.path) || target.path.includes('\0')) return { terminal: result('denied') };
  if (!target.path) return { terminal: result('resolved', sourcePath) };
  const folder = sourcePath.split('/').slice(0, -1).join('/');
  const explicitRelative = /^\.\.?\//.test(target.path);
  let decoded = target.path;
  try { decoded = decodeURIComponent(decoded); } catch { /* literal percent is a valid filename */ }
  const normalized = normalizePath(explicitRelative ? `${folder}/${decoded}` : decoded);
  if (normalized === null) return { terminal: result('denied') };
  const extension = /\.[^/]+$/.test(normalized);
  const names = extension ? [normalized] : [normalized + '.md', normalized + '.markdown'];
  return { target, normalized, names, localNames: names.map((name) => folder ? `${folder}/${name}` : name),
    fallback: !explicitRelative && !target.path.startsWith('/'), result };
}

/** Reusable normalized exact/suffix lookup; mutations preserve ambiguity. */
export class TargetIndex {
  private files = new Set<string>();
  private exact = new Map<string, Set<string>>();
  private suffix = new Map<string, Set<string>>();
  constructor(files: Iterable<string> = []) { for (const file of files) this.add(file); }
  has(file: string): boolean { return this.files.has(file); }
  paths(): Iterable<string> { return this.files; }
  keysFor(file: string): string[] {
    const parts = keyOf(file).split('/');
    return parts.map((_, i) => parts.slice(i).join('/'));
  }
  private change(map: Map<string, Set<string>>, key: string, file: string, add: boolean) {
    if (add) { if (!map.has(key)) map.set(key, new Set()); map.get(key)!.add(file); }
    else { const matches = map.get(key); matches?.delete(file); if (!matches?.size) map.delete(key); }
  }
  add(file: string): boolean {
    if (this.files.has(file)) return false;
    this.files.add(file);
    const [exact, ...suffixes] = this.keysFor(file);
    this.change(this.exact, exact, file, true);
    for (const suffix of suffixes) this.change(this.suffix, suffix, file, true);
    return true;
  }
  delete(file: string): boolean {
    if (!this.files.delete(file)) return false;
    const [exact, ...suffixes] = this.keysFor(file);
    this.change(this.exact, exact, file, false);
    for (const suffix of suffixes) this.change(this.suffix, suffix, file, false);
    return true;
  }
  dependencies(raw: string, sourcePath: string): string[] {
    const prepared = prepareTarget(raw, sourcePath);
    if (prepared.terminal) return [];
    return [...new Set([...prepared.names!, ...(prepared.fallback ? prepared.localNames! : [])].map(keyOf))];
  }
  resolve(raw: string, sourcePath = ''): ResolvedTarget {
    const prepared = prepareTarget(raw, sourcePath);
    if (prepared.terminal) return prepared.terminal;
    const { names, localNames, fallback, normalized, result } = prepared;
    const match = (map: Map<string, Set<string>>, names: string[]) => {
      const found = new Set<string>();
      for (const name of names) for (const file of map.get(keyOf(name)) ?? []) found.add(file);
      return [...found];
    };
    let found = match(this.exact, names!);
    if (!found.length && fallback) found = match(this.exact, localNames!);
    if (!found.length && fallback) found = match(this.suffix, names!);
    if (found.length === 1) return result!('resolved', found[0], found);
    return result!(found.length ? 'ambiguous' : 'missing', normalized, found.sort());
  }
}

export function resolveTarget(raw: string, sourcePath: string, files: readonly string[]): ResolvedTarget {
  // One-shot callers need no index allocation. Long-lived services own TargetIndex.
  const prepared = prepareTarget(raw, sourcePath);
  if (prepared.terminal) return prepared.terminal;
  const { names, localNames, fallback, normalized, result } = prepared;
  const keyed = files.map((file) => ({ file, key: keyOf(file) }));
  const match = (names: string[], suffix = false) => {
    const keys = names.map(keyOf);
    return keyed.filter(({ key }) => keys.some((name) => suffix ? key.endsWith('/' + name) : key === name)).map(({ file }) => file);
  };
  let found = match(names!);
  if (!found.length && fallback) found = match(localNames!);
  if (!found.length && fallback) found = match(names!, true);
  if (found.length === 1) return result!('resolved', found[0], found);
  return result!(found.length ? 'ambiguous' : 'missing', normalized, found.sort());
}
