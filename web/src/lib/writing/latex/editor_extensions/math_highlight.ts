import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { type Range } from '@codemirror/state';
import { decorationInputsChanged } from '../../../decorationDependencies';
import { editorMathRegions, mathSourceVisible } from '../editor_context/mathPresentation';
import { formulaTree } from '../parser/language';
import { getLatexSuiteConfig } from '../snippets/codemirror/config';
import type { Tree } from '@lezer/common';

const tokenCache = new WeakMap<Tree, readonly Range<Decoration>[]>();

function highlight(view: EditorView): DecorationSet {
  if (!getLatexSuiteConfig(view.state).syntaxHighlightingEnabled) return Decoration.none;
  const marks: Range<Decoration>[] = [];
  const add = (from: number, to: number, kind: string) => {
    if (from < to) marks.push(Decoration.mark({ class: 'cm-tex-' + kind }).range(from, to));
  };
  for (const region of editorMathRegions(view.state)) {
    if (!mathSourceVisible(view.state, region) || !view.visibleRanges.some(v => v.from < region.to && v.to > region.from)) continue;
    if (region.kind === 'dollar') {
      add(region.bodyFrom - (region.display ? 2 : 1), region.bodyFrom, 'delimiter');
      if (region.closed) add(region.bodyTo, region.to, 'delimiter');
    }
    const tree = formulaTree(view.state, region.bodyFrom, region.bodyTo);
    const cached = tokenCache.get(tree);
    if (cached) { marks.push(...cached); continue; }
    const start = marks.length;
    tree.iterate({ enter(node) {
      const name = node.name;
      let kind = '';
      if (name.endsWith('CtrlSeq') || name.endsWith('CtrlSym') || name === 'Begin' || name === 'End' || name === 'Csname') kind = 'command';
      else if (name === 'Number') kind = 'number';
      else if (name === 'MathChar') kind = 'variable';
      else if (name === 'MathDelimiter') kind = view.state.sliceDoc(node.from, node.to).startsWith('\\') ? 'command' : 'bracket';
      else if (name === 'Comment') kind = 'comment';
      else if (/^(Open|Close)(Brace|Bracket)$/.test(name)) kind = 'bracket';
      else if (/^(MathSpecialChar|SubScriptSeq|SuperScriptSeq|Ampersand|MacroParameter)$/.test(name)) kind = 'operator';
      else if (name.endsWith('EnvName')) kind = 'environment';
      else if (/^(Normal|LiteralArgContent|VerbContent)$/.test(name)) kind = 'text';
      if (kind) { add(node.from, node.to, kind); return false; }
    } });
    tokenCache.set(tree, marks.slice(start));
  }
  return Decoration.set(marks, true);
}

export const mathSyntaxHighlighting = [ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = highlight(view); }
  update(update: ViewUpdate) {
    if (update.viewportChanged || update.transactions.some(tr => decorationInputsChanged(tr))) this.decorations = highlight(update.view);
  }
}, { decorations: value => value.decorations }), EditorView.baseTheme({
  '.cm-tex-command': { color: 'var(--color-red)' },
  '.cm-tex-delimiter, .cm-tex-bracket, .cm-tex-variable': { color: 'var(--color-cyan)' },
  '.cm-tex-operator': { color: 'var(--color-pink)' },
  '.cm-tex-number': { color: 'var(--color-purple)' },
  '.cm-tex-text': { color: 'var(--color-green)' },
  '.cm-tex-environment': { color: 'var(--color-yellow)' },
  '.cm-tex-comment': { color: 'var(--text-faint)' },
})];
