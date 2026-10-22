import type { MarkdownModel, SourceSpan } from './syntax.js';
import { extractMetadata } from './metadata.js';
import { legacySubheadings } from './legacySubheadings.js';
import { equationContext, equationTarget } from './equations.js';

function formulaRange(model: MarkdownModel, formula: SourceSpan & { anchor?: SourceSpan }): SourceSpan {
  const start = model.text.lastIndexOf('\n', formula.from - 1) + 1;
  const prefix = model.text.slice(start, formula.from);
  return { from: /^(?:[\t ]*> ?)*[\t ]*$/.test(prefix) ? start : formula.from, to: formula.anchor?.to ?? formula.to };
}

export function fragmentRange(model: MarkdownModel, fragment: string): SourceSpan | null {
  if (!fragment) return { from: 0, to: model.text.length };
  const meta = extractMetadata(model);
  let decoded = fragment;
  try { decoded = decodeURIComponent(fragment); } catch { /* literal percent */ }
  if (decoded.startsWith('=')) {
    const formula = equationTarget(equationContext(model), decoded);
    return formula ? formulaRange(model, formula) : null;
  }
  if (decoded.startsWith('^')) {
    const matches = meta.blockIds.filter(candidate => candidate.id === decoded.slice(1));
    if (matches.length !== 1) return null;
    const formula = equationTarget(equationContext(model), decoded);
    if (formula) return formulaRange(model, formula);
    const block = matches[0];
    if (!block) return null;
    const paragraph = model.nodes.filter((node) => ['Paragraph', 'ListItem', 'Blockquote'].includes(node.name) && node.from <= block.from && node.to >= block.to)
      .sort((a, b) => a.to - a.from - (b.to - b.from))[0];
    return paragraph ? { from: paragraph.from, to: paragraph.to } : { from: model.text.lastIndexOf('\n', block.from - 1) + 1, to: block.to };
  }
  if (decoded.startsWith('-')) {
    const subheadings = legacySubheadings(model, meta.comments);
    const item = subheadings.find(candidate => candidate.fragment.normalize('NFC') === decoded.normalize('NFC'));
    if (item) {
      const next = [...subheadings, ...meta.headings].filter(candidate => candidate.from > item.from).sort((a, b) => a.from - b.from)[0];
      return { from: item.from, to: next?.from ?? model.text.length };
    }
  }
  const index = meta.headings.findIndex((heading) => heading.text.normalize('NFC').toLocaleLowerCase() === decoded.normalize('NFC').toLocaleLowerCase());
  if (index < 0) return null;
  const heading = meta.headings[index];
  const next = meta.headings.slice(index + 1).find((candidate) => candidate.level <= heading.level);
  return { from: heading.from, to: next?.from ?? model.text.length };
}
