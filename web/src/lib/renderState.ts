import { StateEffect, StateField } from '@codemirror/state';

export const setLivePreviewEnabled = StateEffect.define<boolean>();

export const livePreviewState = StateField.define<boolean>({
  create: () => true,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setLivePreviewEnabled)) return e.value;
    return value;
  },
});

/**
 * Reading mode = the SAME Live Preview pipeline, read-only: when set, the
 * caret/selection never reveals raw syntax, so everything stays rendered.
 */
export const setLivePreviewReadonly = StateEffect.define<boolean>();

export const livePreviewReadonly = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setLivePreviewReadonly)) return e.value;
    return value;
  },
});
