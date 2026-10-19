import type { Transaction } from '@codemirror/state';
import { compositionSelection } from './inlineHtml';
import { livePreviewState, livePreviewReadonly } from './renderState';
import { sourceRegion, forcedRenderedRegion } from './sourceControls';

/** Layout/semantic decorations use the frozen IME selection, not every effect. */
export function decorationInputsChanged(tr: Transaction, selection = true): boolean {
  if (tr.docChanged) return true;
  const before = tr.startState, after = tr.state;
  if (before.field(livePreviewState) !== after.field(livePreviewState) ||
      before.field(livePreviewReadonly) !== after.field(livePreviewReadonly) || before.readOnly !== after.readOnly) return true;
  const a = before.field(sourceRegion, false), b = after.field(sourceRegion, false);
  if (a?.from !== b?.from || a?.to !== b?.to) return true;
  const forcedA = before.field(forcedRenderedRegion, false), forcedB = after.field(forcedRenderedRegion, false);
  if (forcedA?.from !== forcedB?.from || forcedA?.to !== forcedB?.to) return true;
  return selection && !before.field(compositionSelection).selection.eq(after.field(compositionSelection).selection);
}
