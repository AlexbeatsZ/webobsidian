import type { Transaction } from '@codemirror/state';
import { compositionSelection } from './editorSelection';
import { livePreviewState, livePreviewReadonly } from './renderState';
import { sourceRegion, forcedRenderedRegion } from './sourceControls';
import { refreshBlockEffects } from './blocks/model';
import { renderContext } from './renderContext';
import { getLatexSuiteConfig } from './writing/latex/snippets/codemirror/config';

/** Layout/semantic decorations use the frozen IME selection, not every effect. */
export function decorationInputsChanged(tr: Transaction, selection = true): boolean {
  if (tr.effects.some(e => e.is(refreshBlockEffects))) return true;
  if (tr.docChanged) return true;
  const before = tr.startState, after = tr.state;
  if (before.facet(renderContext) !== after.facet(renderContext)) return true;
  if (getLatexSuiteConfig(before) !== getLatexSuiteConfig(after)) return true;
  if (before.field(livePreviewState) !== after.field(livePreviewState) ||
      before.field(livePreviewReadonly) !== after.field(livePreviewReadonly) || before.readOnly !== after.readOnly) return true;
  const a = before.field(sourceRegion, false), b = after.field(sourceRegion, false);
  if (a?.from !== b?.from || a?.to !== b?.to || a?.kind !== b?.kind) return true;
  const forcedA = before.field(forcedRenderedRegion, false), forcedB = after.field(forcedRenderedRegion, false);
  if (forcedA?.from !== forcedB?.from || forcedA?.to !== forcedB?.to) return true;
  return selection && !before.field(compositionSelection).selection.eq(after.field(compositionSelection).selection);
}
