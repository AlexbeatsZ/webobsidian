import { describe, expect, it, vi } from 'vitest';
import type { EditorView } from '@codemirror/view';
import { bindEditorMode, setEditorMode } from '../activeEditor';
import { setEditorMode as navigateEditorMode } from '../fragmentNavigation';

describe('editor mode routing has one view-local owner', () => {
  it('shares command and navigation bindings without redirecting another view', () => {
    const first = {} as EditorView;
    const second = {} as EditorView;
    const firstHandler = vi.fn();
    const secondHandler = vi.fn();
    const unbindFirst = bindEditorMode(first, firstHandler);
    const unbindSecond = bindEditorMode(second, secondHandler);
    expect(setEditorMode(first, 'source')).toBe(true);
    expect(navigateEditorMode(second, 'reading')).toBe(true);
    expect(firstHandler.mock.calls).toEqual([['source']]);
    expect(secondHandler.mock.calls).toEqual([['reading']]);
    unbindFirst();
    expect(navigateEditorMode(first, 'live')).toBe(false);
    expect(secondHandler).toHaveBeenCalledTimes(1);
    unbindSecond();
  });

  it('retains a replacement callback when an obsolete binding cleans up', () => {
    const view = {} as EditorView;
    const obsolete = vi.fn();
    const current = vi.fn();
    const unbindObsolete = bindEditorMode(view, obsolete);
    const unbindCurrent = bindEditorMode(view, current);
    unbindObsolete();
    expect(navigateEditorMode(view, 'toggle-preview')).toBe(true);
    expect(current).toHaveBeenCalledWith('toggle-preview');
    expect(obsolete).not.toHaveBeenCalled();
    unbindCurrent();
    expect(setEditorMode(view, 'source')).toBe(false);
  });
});
