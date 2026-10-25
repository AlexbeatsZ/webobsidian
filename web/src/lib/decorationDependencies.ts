import type { Transaction } from '@codemirror/state';
import { compositionSelection } from './editorSelection';
import { livePreviewState, livePreviewReadonly } from './renderState';
import { sourceRegion, forcedRenderedRegion } from './sourceControls';
import { refreshBlockEffects } from './blocks/model';
import { renderContext, type RenderContext } from './renderContext';
import { getLatexSuiteConfig } from './writing/latex/snippets/codemirror/config';

type DecorationDependencies = {
  selection?: boolean;
  context?: readonly (keyof RenderContext)[];
  latex?: boolean;
};

function contextValueEqual(key: keyof RenderContext, before: RenderContext, after: RenderContext): boolean {
  if (before[key] === after[key]) return true;
  if (key === 'mathSource') return before.mathSource?.model === after.mathSource?.model && before.mathSource?.from === after.mathSource?.from;
  if (key === 'equations') return before.equations?.equations === after.equations?.equations &&
    before.equations?.from === after.equations?.from && before.equations?.revision === after.equations?.revision;
  if (key === 'embedTrail') return before.embedTrail?.length === after.embedTrail?.length &&
    !!before.embedTrail?.every((path, index) => path === after.embedTrail?.[index]);
  return false;
}

function contextChanged(before: RenderContext, after: RenderContext, keys?: readonly (keyof RenderContext)[]): boolean {
  if (before === after) return false;
  if (keys) return keys.some(key => !contextValueEqual(key, before, after));
  for (const key of Object.keys(before)) if (!contextValueEqual(key as keyof RenderContext, before, after)) return true;
  for (const key of Object.keys(after)) if (!(key in before) && !contextValueEqual(key as keyof RenderContext, before, after)) return true;
  return false;
}

export function decorationInputsChanged(tr: Transaction, inputs: boolean | DecorationDependencies = true): boolean {
  if (tr.effects.some(e => e.is(refreshBlockEffects))) return true;
  if (tr.docChanged) return true;
  const before = tr.startState, after = tr.state;
  const options = typeof inputs === 'boolean' ? undefined : inputs;
  if (contextChanged(before.facet(renderContext), after.facet(renderContext), options?.context)) return true;
  if (options?.latex !== false && getLatexSuiteConfig(before) !== getLatexSuiteConfig(after)) return true;
  if (before.field(livePreviewState) !== after.field(livePreviewState) ||
      before.field(livePreviewReadonly) !== after.field(livePreviewReadonly) || before.readOnly !== after.readOnly) return true;
  const a = before.field(sourceRegion, false), b = after.field(sourceRegion, false);
  if (a?.from !== b?.from || a?.to !== b?.to) return true;
  const forcedA = before.field(forcedRenderedRegion, false), forcedB = after.field(forcedRenderedRegion, false);
  if (forcedA?.from !== forcedB?.from || forcedA?.to !== forcedB?.to) return true;
  return (typeof inputs === 'boolean' ? inputs : inputs.selection !== false) &&
    !before.field(compositionSelection).selection.eq(after.field(compositionSelection).selection);
}
