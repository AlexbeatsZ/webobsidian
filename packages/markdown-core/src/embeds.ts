import { analyzeMarkdown, type MarkdownModel } from './syntax.js';
import { extractMetadata } from './metadata.js';
import { htmlMediaTargets } from './html.js';

/** Declared transclusions only; ordinary links never confer read permission. */
export function embeddedTargets(source: string | MarkdownModel): string[] {
  const model = typeof source === 'string' ? analyzeMarkdown(source.replace(/^\ufeff/, '').replace(/\r\n|\r/g, '\n')) : source;
  const forbidden = [...model.literal, ...model.html, ...model.htmlBlocks, ...extractMetadata(model).comments, ...(model.frontmatter ? [model.frontmatter] : [])];
  const allowed = (from: number, to: number) => !forbidden.some(r => from < r.to && to > r.from) && !(from > 0 && model.text[from - 1] === '\\');
  const targets = new Set<string>();
  for (const m of model.text.matchAll(/!\[\[([^\]\n]+)\]\]/g)) if (allowed(m.index!, m.index! + m[0].length)) targets.add(m[1]);
  for (const node of model.nodes.filter(n => n.name === 'Image')) {
    if (!allowed(node.from, node.to)) continue;
    const text = model.text.slice(node.from, node.to);
    const url = text.match(/\]\(<?(.*?)>?\s*(?:"[^"]*")?\)$/)?.[1];
    if (url) targets.add(url.trim());
  }
  for (const block of model.htmlBlocks) for (const target of htmlMediaTargets(model.text.slice(block.from, block.to))) targets.add(target);
  for (const tag of model.html) for (const target of htmlMediaTargets(tag.raw)) targets.add(target);
  return [...targets].filter(t => !/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(t));
}
