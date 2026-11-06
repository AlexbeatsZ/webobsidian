import type { EditorView } from '@codemirror/view';
import type { ContentTarget, SourceSpan } from '@webobsidian/markdown-core';
import { setIcon } from './icons';
import { contextOf } from './renderContext';
import { copyContentReference, copyKnownReference } from './contentReferenceCommands';

// Kept apart from sourceControls: copying reaches the store, and the store's
// navigation path imports sourceControls.
export interface ReferenceTarget { range: () => SourceSpan; kind: ContentTarget['kind'] }

function referenceButton(view: EditorView | null, target: ReferenceTarget | string, embed: boolean): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'cm-reference-button';
  button.title = embed ? '复制显式引用' : '复制隐式引用';
  button.setAttribute('aria-label', button.title);
  setIcon(button, embed ? 'clipboard' : 'link');
  button.addEventListener('mousedown', (event) => { event.preventDefault(); event.stopPropagation(); });
  button.addEventListener('click', (event) => {
    event.preventDefault(); event.stopPropagation();
    if (typeof target === 'string') void copyKnownReference(target, embed);
    else if (view) void copyContentReference(view, target.range(), embed, target.kind);
  });
  return button;
}

/** Copy buttons for an already identified target, e.g. the original of an embed. */
export function knownReferenceButtons(id: string): HTMLButtonElement[] {
  return [referenceButton(null, id, true), referenceButton(null, id, false)];
}

/** Explicit (embed) and implicit (link) copy buttons; fragments do not own the source identity. */
export function referenceButtons(view: EditorView, target: ReferenceTarget): HTMLButtonElement[] {
  return contextOf(view).sourceFragment ? [] : [referenceButton(view, target, true), referenceButton(view, target, false)];
}

/** Top-right controls of a rendered block, revealed with the block's hover like `</>`. */
export function blockControls(view: EditorView, reference?: ReferenceTarget, source?: HTMLButtonElement): HTMLElement {
  const controls = document.createElement('span');
  controls.className = 'cm-block-controls';
  if (reference) controls.append(...referenceButtons(view, reference));
  if (source) controls.append(source);
  return controls;
}
