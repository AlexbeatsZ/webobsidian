import { analyzeMarkdown, mathRegions, type MarkdownModel } from '@webobsidian/markdown-core';

interface Node {
  type: string;
  position: { start: Point; end: Point };
  children?: Node[];
  value?: string;
}
interface Point {
  offset: number;
  line: number;
  column: number;
}
const models = new Map<string, MarkdownModel>();
const trees = new WeakMap<MarkdownModel, Node>();
export function useWritingModel(model: MarkdownModel) {
  models.delete(model.text);
  models.set(model.text, model);
  while (models.size > 8) models.delete(models.keys().next().value!);
}
export function writingModel(text: string) {
  let model = models.get(text);
  if (!model) {
    model = analyzeMarkdown(text);
    useWritingModel(model);
  }
  return model;
}
/** Adapt the host's existing syntax to the rule library's positional vocabulary. */
export function markdownAst(text: string): Node {
  const model = writingModel(text);
  const cached = trees.get(model);
  if (cached) return cached;
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  const point = (offset: number): Point => {
    let lo = 0,
      hi = starts.length;
    while (lo < hi) {
      const m = (lo + hi) >>> 1;
      if (starts[m] <= offset) lo = m + 1;
      else hi = m;
    }
    return { offset, line: lo, column: offset - starts[lo - 1] + 1 };
  };
  const node = (type: string, from: number, to: number): Node => ({
    type,
    position: { start: point(from), end: point(to) },
  });
  const root = node('root', 0, text.length);
  root.children = [];
  const mapped = new Map<number, Node>();
  const math = mathRegions(model).filter((r) => r.closed && r.kind === 'dollar');
  const names: Record<string, string> = {
    Paragraph: 'paragraph',
    Emphasis: 'emphasis',
    StrongEmphasis: 'strong',
    FencedCode: 'code',
    CodeBlock: 'code',
    InlineCode: 'inlineCode',
    Image: 'image',
    Link: 'link',
    Autolink: 'link',
    ListItem: 'listItem',
    BulletList: 'list',
    OrderedList: 'list',
    Blockquote: 'blockquote',
    HorizontalRule: 'thematicBreak',
    HTMLBlock: 'html',
    HTMLTag: 'html',
  };
  for (let index = 0; index < model.nodes.length; index++) {
    const n = model.nodes[index];
    const type = /^(ATX|Setext)Heading[1-6]$/.test(n.name) ? 'heading' : names[n.name];
    if (
      !type ||
      (model.frontmatter && n.from < model.frontmatter.to) ||
      math.some((r) => n.from >= r.from && n.to <= r.to)
    )
      continue;
    const next = node(type, n.from, n.to);
    let parent = n.parent;
    while (parent !== null && !mapped.has(parent)) parent = model.nodes[parent].parent;
    const host = parent === null ? root : mapped.get(parent)!;
    (host.children ??= []).push(next);
    mapped.set(index, next);
  }
  for (const r of math) {
    const next = node(r.display ? 'math' : 'inlineMath', r.from, r.to);
    let host = root,
      width = text.length + 1;
    for (const n of mapped.values())
      if (
        n.children &&
        n.position.start.offset <= r.from &&
        n.position.end.offset >= r.to &&
        n.position.end.offset - n.position.start.offset < width
      ) {
        host = n;
        width = n.position.end.offset - n.position.start.offset;
      }
    (host.children ??= []).push(next);
  }
  for (const m of text.matchAll(/^\[\^[^\]\n]+\]:[^\n]*(?:\n(?:[ \t]+[^\n]*|[ \t]*(?=\n)))*/gm)) {
    if (model.literal.some((r) => m.index! >= r.from && m.index! < r.to)) continue;
    root.children.push(node('footnoteDefinition', m.index!, m.index! + m[0].length));
  }
  const fill = (n: Node) => {
    n.children?.sort((a, b) => a.position.start.offset - b.position.start.offset);
    for (const child of n.children ?? []) fill(child);
    if (!['paragraph', 'heading', 'strong', 'emphasis', 'link'].includes(n.type)) return;
    let from = n.position.start.offset,
      to = n.position.end.offset;
    if (n.type === 'heading') {
      const m = text.slice(from, to).match(/^#{1,6}[ \t]+/);
      if (m) from += m[0].length;
      to -= text.slice(from, to).match(/(?:\n[=-]+|[ \t]+#+[ \t]*)$/)?.[0].length ?? 0;
    }
    if (n.type === 'strong' || n.type === 'emphasis') {
      const w = n.type === 'strong' ? 2 : 1;
      from += w;
      to -= w;
    }
    const result: Node[] = [];
    for (const child of n.children ?? []) {
      const a = child.position.start.offset,
        b = child.position.end.offset;
      if (a > from) {
        const t = node('text', from, a);
        t.value = text.slice(from, a);
        result.push(t);
      }
      result.push(child);
      from = Math.max(from, b);
    }
    if (from < to) {
      const t = node('text', from, to);
      t.value = text.slice(from, to);
      result.push(t);
    }
    n.children = result;
  };
  fill(root);
  trees.set(model, root);
  return root;
}
