/** Browser-safe tag source operations. Also used for unsaved DocumentSessions. */
import { SourceDocument, type SourceChange } from '../source.js';
import { analyzeMarkdown, type MarkdownModel, type SourceSpan } from '../syntax.js';
import { extractMetadata } from '../metadata.js';
import { mathRegions } from '../math.js';
import { canEditProperties, readPropertyRows, patchPropertyRows } from '../properties.js';
import { matchesTag, normalizeStoredTags, tagKey, tagName, validTag } from '@webobsidian/search-core/query';
import type { TagOperation } from './types.js';

export function validateTagOperation(operation: TagOperation): TagOperation {
  if (operation.kind === 'folder-rules') return operation;
  const values = operation.kind === 'rename' ? [operation.from, operation.to] : operation.tags;
  if (!values.length || values.length > 128 || values.some((value) => !validTag(value)))
    throw Object.assign(new Error('Tags must contain letters, marks, numbers, _, - or /; numeric-only names and empty path segments are unsupported'), { status: 400 });
  return operation.kind === 'rename'
    ? { ...operation, from: tagName(operation.from), to: tagName(operation.to) }
    : { ...operation, tags: [...new Set(operation.tags.map(tagName))] };
}

export function inTagScope(path: string, scope: import('./types.js').TagScope): boolean {
  if (!/\.(?:md|markdown)$/i.test(path)) return false;
  if (scope.kind === 'vault') return true;
  if (scope.kind === 'files') return scope.paths.includes(path);
  const folder = scope.path.replace(/\/+$/, '');
  return !folder || path.startsWith(folder + '/');
}

function selected(tag: string, operation: TagOperation): boolean {
  return operation.kind === 'rename' ? matchesTag(tag, operation.from, operation.descendants !== false) :
    operation.kind === 'remove' && operation.tags.some((wanted) => matchesTag(tag, wanted, operation.descendants !== false));
}
export function transformTag(value: string, operation: TagOperation): string {
  if (!selected(value, operation)) return value;
  if (operation.kind === 'remove') return '';
  if (operation.kind !== 'rename') return value;
  const original = value.trim().replace(/^#+/, '');
  const suffix = original.split('/').slice(tagName(operation.from).split('/').length);
  const next = tagName(operation.to) + (suffix.length ? '/' + suffix.join('/') : '');
  return (value.startsWith('#') ? '#' : '') + next;
}

/** Uses the shared syntax exclusions and math analysis, never rendered DOM. */
export function inlineTagRanges(model: MarkdownModel): (SourceSpan & { tag: string })[] {
  const metadata = extractMetadata(model);
  const excluded = [...model.literal, ...model.html, ...model.htmlBlocks, ...metadata.comments,
    ...mathRegions(model), ...(model.frontmatter ? [model.frontmatter] : []),
    ...model.nodes.filter((n) => ['Link', 'Image', 'URL', 'Autolink'].includes(n.name))];
  for (const match of model.text.matchAll(/!?\[\[[^\]\n]*\]\]/g)) excluded.push({ from: match.index!, to: match.index! + match[0].length });
  const result: (SourceSpan & { tag: string })[] = [];
  for (const match of model.text.matchAll(/(^|[\s>])(#[\p{L}\p{M}\p{N}_/-]+)/gu)) {
    const from = match.index! + match[1].length, to = from + match[2].length;
    if (validTag(match[2]) && !excluded.some((span) => from < span.to && to > span.from))
      result.push({ from, to, tag: match[2] });
  }
  return result;
}

/** Conservative positions: even a quoted whitespace-hash is protected here. */
function yamlComments(text: string): SourceSpan[] {
  const result: SourceSpan[] = [];
  for (const match of text.matchAll(/(^|[ \t])#[^\n]*/gm))
    result.push({ from: match.index! + match[1].length, to: match.index! + match[0].length });
  return result;
}

function frontmatterSpan(text: string): { from: number; to: number } | null {
  if (!text.startsWith('---\n')) {
    if (/^---[ \t]*(?:\n|$)/.test(text)) throw new Error('Unsupported frontmatter delimiter; file skipped');
    return null;
  }
  const closing = /^---[ \t]*(?:\n|$)/gm;
  closing.lastIndex = 4;
  const match = closing.exec(text);
  if (!match) throw new Error('Unclosed or unsupported frontmatter; file skipped');
  return { from: 4, to: match.index };
}

function fieldValue(value: string, alias: boolean, operation: TagOperation): string {
  if (alias) {
    if (operation.kind !== 'rename') return value;
    return value.split(/(\s*,\s*)/).map((part, index) => index % 2 || !part.trim().startsWith('#') || !validTag(part) ? part :
      part.replace(part.trim(), transformTag(part.trim(), operation))).join('');
  }
  return value.split(/([,，\s]+)/u).map((part, index) => index % 2 ? part : transformTag(part, operation)).join('');
}

export interface TagSourcePlan { changes: SourceChange[]; expected: string[]; raw: string }
/** Entire-file validation precedes patches; one unsupported field aborts every edit. */
export function planTagSource(raw: string, input: TagOperation, analysis?: MarkdownModel): TagSourcePlan {
  const operation = validateTagOperation(input), source = new SourceDocument(raw);
  if (operation.kind === 'folder-rules') throw new Error('Resolve folder rules for the file before source planning');
  const text = source.text;
  const model = analysis?.text === text ? analysis : analyzeMarkdown(text);
  const changes: SourceChange[] = [];
  const fm = frontmatterSpan(text);
  if (fm) {
    const yaml = text.slice(fm.from, fm.to);
    if (!canEditProperties(yaml)) throw new Error('Invalid YAML, duplicate keys or complex mapping; file skipped');
    const rows = readPropertyRows(yaml);
    if (rows.some((row) => row.key === '<<')) throw new Error('YAML merge keys may supply tags indirectly; file skipped');
    const targets = rows.filter((row) => /^tags?$/i.test(row.key) || (operation.kind === 'rename' && /^alias(?:es)?$/i.test(row.key)));
    if (targets.some((row) => !row.editable)) throw new Error('Anchored, aliased, block or complex tag/alias values require source editing; file skipped');
    const existing = new Set(targets.filter((row) => /^tags?$/i.test(row.key)).flatMap((row) => row.values.flatMap(normalizeStoredTags)).map(tagKey));
    const mergedKeys = operation.kind === 'add' ? [...existing, ...operation.tags.map(tagKey)] : [];
    const ancestors = new Set(operation.kind === 'add' && operation.pruneAncestors ? mergedKeys.filter(key => mergedKeys.some(other => other.startsWith(key + '/'))) : []);
    let added = false;
    const desired = rows.map((row) => {
      const alias = /^alias(?:es)?$/i.test(row.key);
      if (!/^tags?$/i.test(row.key) && !(operation.kind === 'rename' && alias)) return row;
      let values = row.values.map((value) => fieldValue(value, alias, operation));
      if (operation.kind === 'add' && ancestors.size) values = values.map(value =>
        value.split(/([,，\s]+)/u).map((part, index) => index % 2 || !ancestors.has(tagKey(part)) ? part : '').join('')
          .replace(/^[,，\s]+|[,，\s]+$/gu, '')).filter(Boolean);
      if (operation.kind === 'remove' && row.list) values = values.filter((v) => normalizeStoredTags(v).length > 0);
      if (operation.kind === 'add' && !alias && !added) {
        const additions = operation.tags.filter((tag) => !existing.has(tagKey(tag)) && !ancestors.has(tagKey(tag)));
        added = true;
        if (additions.length) values = [...(row.list ? values : values.flatMap(value => value.split(/[,，\s]+/u).filter(Boolean))), ...additions];
        else return ancestors.size && JSON.stringify(values) !== JSON.stringify(row.values) ? { ...row, values } : row;
        return { ...row, values, list: true, forceList: !row.list };
      }
      return { ...row, values };
    });
    if (operation.kind === 'add' && !added) desired.push({ key: 'tags', values: operation.tags.filter(tag => !ancestors.has(tagKey(tag))), list: true });
    const patches = patchPropertyRows(yaml, desired);
    // The shared property patcher may need to remove a sequence item. Refuse a
    // structural span containing a comment rather than deleting that comment.
    const comments = yamlComments(yaml);
    if (patches.some((patch) => comments.some((comment) => patch.from < comment.to && patch.to > comment.from)))
      throw new Error('Structural tag change would consume a YAML comment; edit source or simplify that field');
    const check = new SourceDocument(yaml);
    check.apply(patches);
    if (!canEditProperties(check.text)) throw new Error('Tag edit would produce unsafe YAML; file skipped');
    const actualRows = readPropertyRows(check.text);
    if (actualRows.length !== desired.length || desired.some((row, index) => row.key !== actualRows[index]?.key ||
      JSON.stringify(row.values) !== JSON.stringify(actualRows[index]?.values)))
      throw new Error('Tag YAML token validation failed; file skipped');
    changes.push(...patches.map((patch) => ({ ...patch, from: patch.from + fm.from, to: patch.to + fm.from })));
  } else if (operation.kind === 'add') {
    const tags = operation.tags.filter(tag => !operation.pruneAncestors || !operation.tags.some(other => tagKey(other).startsWith(tagKey(tag) + '/')));
    changes.push({ from: 0, to: 0, insert: `---\ntags: [${tags.map((tag) => JSON.stringify(tag)).join(', ')}]\n---\n` });
  }
  if (operation.kind !== 'add') for (const span of inlineTagRanges(model)) {
    // Empty frontmatter isn't recognized by older shared syntax. Always exclude
    // our explicitly validated property span as well.
    if (fm && span.from < fm.to) continue;
    const insert = transformTag(span.tag, operation);
    if (insert !== span.tag) changes.push({ from: span.from, to: span.to, insert });
  }
  changes.sort((a, b) => a.from - b.from || a.to - b.to);
  const expected = changes.map((change) => text.slice(change.from, change.to));
  source.apply(changes);
  return { changes, expected, raw: source.raw };
}

export function validateCapturedTagChanges(text: string, changes: readonly SourceChange[], expected: readonly string[]): void {
  if (changes.length !== expected.length || changes.some((change, index) => text.slice(change.from, change.to) !== expected[index]))
    throw new Error('Tag positions changed after preview; preview again');
}
