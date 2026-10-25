import type { EditorState } from '@codemirror/state';
import { mathBodyOffset, mathRegions, type MathRegion, type SourceSpan } from '@webobsidian/markdown-core';
import { compositionSelection } from '../../../editorSelection';
import { livePreviewReadonly, livePreviewState } from '../../../renderState';
import { forceRendered, sourceIsOpen } from '../../../sourceControls';
import { syntaxModel } from '../../../syntaxModel';
import { getLatexSuiteConfig } from '../snippets/codemirror/config';
import { formulaTree } from '../parser/language';
import { canDecorateMath } from '../../../mathjax';

/** Shared by rendered formulas, TeX overlays and previews. Selection is view-local. */
export function mathSourceVisible(state: EditorState, range: SourceSpan): boolean {
  if (state.readOnly || state.field(livePreviewReadonly, false)) return false;
  if (!state.field(livePreviewState, false)) return true;
  if (forceRendered(state, range)) return false;
  if (sourceIsOpen(state, range)) return true;
  const selection = state.field(compositionSelection, false)?.selection ?? state.selection;
  return selection.ranges.some(s => s.empty
    ? s.head >= range.from && s.head <= range.to
    : s.from < range.to && s.to > range.from);
}

export function editorMathRegions(state: EditorState): readonly MathRegion[] {
  return mathRegions(state.field(syntaxModel), getLatexSuiteConfig(state).forceMathLanguages);
}

export interface MathPreview {
  region: MathRegion;
  placement: 'inline' | 'document';
}

/** Preview boundaries include the dollar delimiters; snippet bounds stay body-only. */
export function mathPreview(state: EditorState): MathPreview | undefined {
  const settings = getLatexSuiteConfig(state);
  if (!settings.mathPreviewEnabled || state.readOnly || state.field(livePreviewReadonly, false)) return;
  const selection = state.field(compositionSelection, false)?.selection ?? state.selection;
  const regions = editorMathRegions(state), head = selection.main.head;
  let low = 0, high = regions.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (regions[mid].from <= head) low = mid + 1;
    else high = mid;
  }
  const region = regions[low - 1];
  if (!region || head > region.to || !region.closed || !region.tex.trim() || !mathSourceVisible(state, region)) return;
  // A selection must belong to one formula. Selecting the whole note is not an edit preview.
  if (selection.ranges.length !== 1 || selection.main.from < region.from || selection.main.to > region.to) return;
  if (region.display || region.block || region.tex.includes('\n')) {
    if (state.field(livePreviewState, false) && !settings.mathPreviewLivePreviewDisplay) return;
    return { region, placement: 'document' };
  }
  return { region, placement: 'inline' };
}

export const PREVIEW_CURSOR_CLASS = 'mjx-latex-suite-cursor';
export const PREVIEW_HIGHLIGHT_CLASS = 'mjx-latex-suite-math-preview-highlight';

/** Only insert presentation markup at a known math-text position, never in a command/argument name. */
export function mathPreviewTex(state: EditorState, region: MathRegion): string {
  const settings = getLatexSuiteConfig(state), selection = state.selection.main;
  if (state.field(compositionSelection, false)?.active || !selection.empty || !canDecorateMath(region.tex)) return region.tex;
  const pos = selection.head;
  if (pos <= region.bodyFrom || pos >= region.bodyTo || !region.segments.some(s => pos >= s.from && pos <= s.to)) return region.tex;
  const tree = formulaTree(state, region.bodyFrom, region.bodyTo);
  for (const bias of [-1, 1] as const) {
    const node = tree.resolveInner(pos, bias);
    if (!/^(MathChar|Number|MathSpecialChar|Whitespace)$/.test(node.name)) return region.tex;
    let math = false;
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (parent.type.isError) return region.tex;
      if (parent.name === 'MathArgument' && parent.firstChild?.name !== 'OpenBrace') return region.tex;
      if (/^(TextArgument|ShortArg|LongArg|ShortOptionalArg|UrlArgument|DefinitionFragment|EnvNameGroup|LabelArgument|RefArgument)$/.test(parent.name)) return region.tex;
      if (parent.name === 'Math') math = true;
    }
    if (!math) return region.tex;
  }
  const offset = mathBodyOffset(region, pos), before = region.tex.slice(0, offset);
  // A script marker or an unfinished control word consumes the next token as an argument.
  if (/[\\^_]\s*$/.test(before) || /\\[A-Za-z]+\s*$/.test(before)) return region.tex;
  const cursor = settings.mathPreviewCursor ? ` \\class{${PREVIEW_CURSOR_CLASS}}{${settings.mathPreviewCursor}} ` : '';
  if (!settings.mathPreviewBracketHighlighting) return before + cursor + region.tex.slice(offset);
  // Escaped braces keep their two-character width so the source-to-TeX offset remains exact.
  const text = region.tex.replace(/\\[\\{}]/g, '  ');
  let left = -1, right = -1, depth = 0;
  for (let i = offset - 1; i >= 0; i--) {
    if (text[i] === '}') depth++;
    else if (text[i] === '{') { if (depth-- === 0) { left = i; break; } }
  }
  depth = 0;
  for (let i = offset; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { if (depth-- === 0) { right = i; break; } }
  }
  return left < 0 || right < 0 ? before + cursor + region.tex.slice(offset)
    : region.tex.slice(0, left + 1) + `\\class{${PREVIEW_HIGHLIGHT_CLASS}}{` +
      region.tex.slice(left + 1, offset) + cursor + region.tex.slice(offset, right) + '}' + region.tex.slice(right);
}
