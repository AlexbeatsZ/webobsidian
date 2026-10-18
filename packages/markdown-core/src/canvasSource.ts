import { parse, parseTree, findNodeAtLocation, type ParseError, type JSONPath } from 'jsonc-parser';

/** Only Canvas-owned keys are patched. Unknown root/node/edge fields survive. */
export function patchCanvasSource(raw: string, next: { nodes: unknown[]; edges: unknown[] }): string {
  const bom = raw.startsWith('\ufeff') ? '\ufeff' : '';
  let text = bom ? raw.slice(1) : raw;
  if (!text.trim()) return bom + JSON.stringify(next, null, '\t');
  const errors: ParseError[] = [];
  const current = parse(text, errors);
  if (errors.length || !current || !Array.isArray(current.nodes) || !Array.isArray(current.edges)) throw new Error('Invalid Canvas source; edit its source before saving');
  const write = (path: JSONPath, value: unknown) => {
    const tree = parseTree(text)!;
    const node = findNodeAtLocation(tree, path);
    if (node && value !== undefined) { text = text.slice(0, node.offset) + JSON.stringify(value) + text.slice(node.offset + node.length); return; }
    const parent = findNodeAtLocation(tree, path.slice(0, -1));
    if (!parent || parent.type !== 'object') throw new Error('Unsupported Canvas structure');
    const properties = parent.children ?? [];
    if (node && value === undefined) {
      const property = node.parent!, index = properties.indexOf(property);
      const from = index === properties.length - 1 && index > 0 ? properties[index - 1].offset + properties[index - 1].length : property.offset;
      const to = index < properties.length - 1 ? properties[index + 1].offset : property.offset + property.length;
      text = text.slice(0, from) + text.slice(to); return;
    }
    if (value === undefined) return;
    const last = properties.at(-1);
    const at = last ? last.offset + last.length : parent.offset + 1;
    const leading = properties[0] ? text.slice(parent.offset + 1, properties[0].offset) : '';
    const insert = (last ? ',' + leading : '') + JSON.stringify(path.at(-1)) + ':' + JSON.stringify(value);
    text = text.slice(0, at) + insert + text.slice(at);
  };
  const diff = (before: unknown, after: unknown, path: JSONPath) => {
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    if (Array.isArray(before) && Array.isArray(after)) {
      const keyed = before.every(item => typeof item?.id === 'string') && after.every(item => typeof item?.id === 'string');
      if (!keyed) { write(path, after); return; }
      const byId = new Map(before.map((item, i) => [item.id, i]));
      for (const item of after) { const index = byId.get(item.id); if (index !== undefined) diff(before[index], item, [...path, index]); }
      if (before.length === after.length && before.every((item, i) => item.id === after[i].id)) return;
      const array = findNodeAtLocation(parseTree(text)!, path)!;
      const children = array.children ?? [];
      const oldTokens = new Map(before.map((item, i) => [item.id, text.slice(children[i].offset, children[i].offset + children[i].length)]));
      const leading = children[0] ? text.slice(array.offset + 1, children[0].offset) : '';
      const last = children.at(-1);
      const trailing = last ? text.slice(last.offset + last.length, array.offset + array.length - 1) : text.slice(array.offset + 1, array.offset + array.length - 1);
      const separators = children.slice(0, -1).map((node, i) => text.slice(node.offset + node.length, children[i + 1].offset));
      const pieces = after.map((item, i) => (oldTokens.get(item.id) ?? JSON.stringify(item)) + (i === after.length - 1 ? '' : separators[byId.get(item.id) ?? -1] ?? separators[0] ?? ',' + leading));
      text = text.slice(0, array.offset + 1) + leading + pieces.join('') + trailing + text.slice(array.offset + array.length - 1);
    } else if (before && after && typeof before === 'object' && typeof after === 'object' && !Array.isArray(before) && !Array.isArray(after)) {
      for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) diff((before as Record<string, unknown>)[key], (after as Record<string, unknown>)[key], [...path, key]);
    } else write(path, after);
  };
  diff(current.nodes, next.nodes, ['nodes']); diff(current.edges, next.edges, ['edges']);
  return bom + text;
}
