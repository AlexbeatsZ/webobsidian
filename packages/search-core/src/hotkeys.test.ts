import { expect, it } from 'vitest';
import { bindingFromString, eventHotkey, hotkeyLabel, hotkeySignature } from './hotkeys';

it('keeps Control and Option distinct from Command when importing, recording and displaying Mac shortcuts', () => {
  const binding = bindingFromString('Control+Option+Z')!;
  expect(binding).toEqual({ modifiers: ['Ctrl', 'Alt'], key: 'Z' });
  expect(hotkeyLabel(binding, true)).toBe('Control + Option + Z');
  expect(hotkeyLabel(binding, false)).toBe('Ctrl + Alt + Z');
  const recorded = eventHotkey({ key: 'Ω', code: 'KeyZ', ctrlKey: true, altKey: true, metaKey: false, shiftKey: false })!;
  expect(hotkeySignature(recorded, true)).toBe(hotkeySignature(binding, true));
  expect(hotkeySignature(binding, true)).not.toBe(hotkeySignature({ modifiers: ['Meta', 'Alt'], key: 'Z' }, true));
  expect(eventHotkey({ key: 'Dead', code: 'KeyE', ctrlKey: false, altKey: true, metaKey: false, shiftKey: false }))
    .toEqual({ modifiers: ['Alt'], key: 'E' });
});
