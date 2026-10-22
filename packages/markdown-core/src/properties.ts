import { parseDocument, isMap, isScalar, isSeq, isAlias, isNode, stringify, type Node, type Scalar, type YAMLSeq } from 'yaml';
import type { SourceChange } from './source.js';

const yamlDocuments=new Map<string,ReturnType<typeof parseDocument>>();
/** Property editing and formatting share token-preserving YAML parsing. */
export function parseYamlSource(source:string,mutable=false){
  let document=yamlDocuments.get(source);
  if(!document){document=parseDocument(source,{keepSourceTokens:true,uniqueKeys:true});yamlDocuments.set(source,document);
    while(yamlDocuments.size>16)yamlDocuments.delete(yamlDocuments.keys().next().value!);}
  return mutable?document.clone():document;
}

export interface PropertyRow {
  key: string; values: string[]; list: boolean; editable?: boolean;
  scalarType?: string; forceList?: boolean;
}
interface Entry { key: string; keyNode: Scalar; node: Node | null; row: PropertyRow }
const scalarText = (node: Scalar) => node.value == null ? '' : String(node.value);
const simpleScalar = (node: unknown): node is Scalar => isScalar(node) && !node.anchor && !node.tag &&
  node.type !== 'BLOCK_LITERAL' && node.type !== 'BLOCK_FOLDED' && (node.value === null || ['string', 'number', 'boolean'].includes(typeof node.value));

function entries(yaml: string): Entry[] {
  const document = parseYamlSource(yaml);
  if (document.errors.length) throw new Error('Invalid or duplicate YAML keys; edit source');
  if (document.contents === null) return [];
  if (!isMap(document.contents)) throw new Error('Properties must be a YAML mapping; edit source');
  return document.contents.items.map((pair) => {
    if (!isScalar(pair.key) || typeof pair.key.value !== 'string') throw new Error('Complex YAML keys require source editing');
    const key = pair.key.value;
    const node = isNode(pair.value) ? pair.value : null;
    const list = isSeq(node);
    const editable = node === null || simpleScalar(node) ||
      (list && !node.anchor && !node.tag && node.items.every(simpleScalar));
    const values = node === null ? [''] : simpleScalar(node) ? [scalarText(node)] :
      list && editable ? node.items.map((item) => scalarText(item as Scalar)) :
      [node.range ? yaml.slice(node.range[0], node.range[1]) : 'Complex value'];
    return { key, keyNode: pair.key, node, row: { key, values, list: Boolean(list && editable), editable } };
  });
}

export function readPropertyRows(yaml: string): PropertyRow[] {
  try { return entries(yaml).map((entry) => entry.row); } catch { return []; }
}
export function canEditProperties(yaml: string): boolean {
  try { entries(yaml); return true; } catch { return false; }
}

function valueText(value: string, original?: Node | null, scalarType?: string): string {
  if (scalarType === 'checkbox' && /^(?:true|false)$/.test(value)) return value;
  if (scalarType === 'number' && value.trim() && Number.isFinite(Number(value))) return value;
  if (isScalar(original)) {
    if (original.type === 'QUOTE_SINGLE') return "'" + value.replace(/'/g, "''") + "'";
    if (original.type === 'QUOTE_DOUBLE') return JSON.stringify(value);
    if (typeof original.value === 'boolean' && /^(true|false)$/.test(value)) return value;
    if (typeof original.value === 'number' && value.trim() && Number.isFinite(Number(value))) return value;
  }
  return stringify(value, { lineWidth: 0 }).trimEnd();
}
const lineStart = (text: string, offset: number) => text.lastIndexOf('\n', offset - 1) + 1;
const lineEnd = (text: string, offset: number) => text[offset - 1] === '\n' ? offset : (text.indexOf('\n', offset) < 0 ? text.length : text.indexOf('\n', offset) + 1);

function patchSequence(yaml: string, node: YAMLSeq, next: string[]): SourceChange[] {
  const items = node.items as Scalar[];
  const old = items.map(scalarText);
  if (!next.length && items.length && !node.flow) {
    const from = node.range![0], to = node.range![1];
    return [{ from, to, insert: '[]' + (yaml[to - 1] === '\n' ? '\n' : '') }];
  }
  if (old.length === next.length) return items.flatMap((item, index) => old[index] === next[index] ? [] : [{
    from: item.range![0], to: item.range![1], insert: valueText(next[index], item),
  }]);
  let first = 0, end = old.length, nextEnd = next.length;
  while (first < end && first < nextEnd && old[first] === next[first]) first++;
  while (end > first && nextEnd > first && old[end - 1] === next[nextEnd - 1]) { end--; nextEnd--; }
  const middle = next.slice(first, nextEnd);
  if (node.flow) {
    if (first === end) {
      if (end < items.length) return [{ from: items[end].range![0], to: items[end].range![0], insert: middle.map((value) => valueText(value)).join(', ') + ', ' }];
      const closing = node.range![1] - 1;
      const trailing = items.length ? yaml.slice(items.at(-1)!.range![1], closing) : '';
      return [{ from: closing, to: closing, insert: (items.length && !trailing.includes(',') ? ', ' : '') + middle.map((value) => valueText(value)).join(', ') }];
    }
    if (end < items.length) return [{ from: items[first].range![0], to: items[end].range![0], insert: middle.length ? middle.map((value) => valueText(value)).join(', ') + ', ' : '' }];
    return [{ from: first ? items[first - 1].range![1] : items[first].range![0], to: items[end - 1].range![1],
      insert: (first && middle.length ? ', ' : '') + middle.map((value) => valueText(value)).join(', ') }];
  }
  const sample = items[first] ?? items.at(-1);
  const prefix = sample ? yaml.slice(lineStart(yaml, sample.range![0]), sample.range![0]) : '  - ';
  const from = first < items.length ? lineStart(yaml, items[first].range![0]) : items.length ? lineEnd(yaml, items.at(-1)!.range![2]) : node.range![1];
  const to = end > first ? lineEnd(yaml, items[end - 1].range![2]) : from;
  let insert = middle.map((value) => prefix + valueText(value) + '\n').join('');
  if (from === yaml.length && from > 0 && !yaml.endsWith('\n') && insert) insert = '\n' + insert;
  if (to === yaml.length && !yaml.endsWith('\n')) insert = insert.replace(/\n$/, '');
  return [{ from, to, insert }];
}

/** The only properties write path: patch selected key/value tokens, never stringify the mapping. */
export function patchPropertyRows(yaml: string, desired: readonly PropertyRow[]): SourceChange[] {
  const old = entries(yaml);
  const keys = new Set(desired.map((row) => row.key));
  if (keys.size !== desired.length || desired.some((row) => !row.key)) throw new Error('Property names must be nonempty and unique');
  const changes: SourceChange[] = [];
  const handled = new Set<string>();
  for (let index = 0; index < old.length; index++) {
    const entry = old[index];
    let row = desired.find((candidate) => candidate.key === entry.key);
    if (!row && desired[index] && !handled.has(desired[index].key) && !old.some((candidate) => candidate.key === desired[index].key)) {
      row = desired[index];
      changes.push({ from: entry.keyNode.range![0], to: entry.keyNode.range![1], insert: valueText(row.key, entry.keyNode) });
    }
    if (!row) {
      changes.push({ from: lineStart(yaml, entry.keyNode.range![0]),
        to: lineEnd(yaml, entry.node?.range?.[2] ?? entry.keyNode.range![2]), insert: '' });
      continue;
    }
    handled.add(row.key);
    if (JSON.stringify(row.values) === JSON.stringify(entry.row.values) && !row.forceList) continue;
    if (!entry.row.editable || isAlias(entry.node)) throw new Error('Complex property requires source editing: ' + entry.key);
    if (isSeq(entry.node) && row.list && !row.forceList) {
      changes.push(...patchSequence(yaml, entry.node, row.values)); continue;
    }
    const list = row.forceList ? row.list : row.list && (entry.row.list || row.values.length !== 1);
    const insert = list ? '[' + row.values.map((value) => valueText(value)).join(', ') + ']' : valueText(row.values[0] ?? '', entry.node, row.scalarType);
    if (entry.node?.range) changes.push({ from: entry.node.range[0], to: entry.node.range[1], insert });
    else {
      const colon = yaml.indexOf(':', entry.keyNode.range![1]);
      changes.push({ from: colon + 1, to: colon + 1, insert: ' ' + insert });
    }
  }
  const additions = desired.filter((row) => !handled.has(row.key));
  if (additions.length) changes.push({ from: yaml.length, to: yaml.length,
    insert: (yaml && !yaml.endsWith('\n') ? '\n' : '') + additions.map((row) =>
      valueText(row.key) + ': ' + (row.list ? '[' + row.values.map((value) => valueText(value)).join(', ') + ']' : valueText(row.values[0] ?? '', undefined, row.scalarType)) + '\n').join(''),
  });
  return changes.sort((a, b) => a.from - b.from || a.to - b.to);
}
