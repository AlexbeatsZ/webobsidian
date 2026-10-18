import { expect, it } from 'vitest';
import { patchCanvasSource } from './canvasSource.js';

it('changes only a canvas node text token and preserves unknown data, BOM and whitespace', () => {
  const raw = '\ufeff{\r\n  "extra": {"unknown":true},\n "nodes": [{ "id":"a", "type":"text", "text" : "old", "plugin":7 }],\r\n "edges": []\r\n}';
  const next = { nodes: [{ id: 'a', type: 'text', text: 'new', plugin: 7 }], edges: [] };
  expect(patchCanvasSource(raw, next)).toBe(raw.replace('"old"', '"new"'));
  expect(patchCanvasSource(raw, { nodes: [{ ...next.nodes[0], text: 'old' }], edges: [] })).toBe(raw);
});

it('rejects invalid canvas source instead of overwriting it', () => {
  expect(() => patchCanvasSource('{bad json', { nodes: [], edges: [] })).toThrow();
});

it('retains existing object tokens when inserting, deleting, moving and editing fields', () => {
  const a = '{ "id" : "a", "text" : "old", "plugin": { "x" : 1 } }';
  const b = '{"id":"b",\r\n "text":"second"}';
  const raw = '{"nodes":[\n ' + a + ',\r\n ' + b + '\n], "edges":[], "extra": 7}';
  const first = JSON.parse(raw);
  const moved = patchCanvasSource(raw, { nodes: [first.nodes[1], first.nodes[0], { id: 'c', text: 'new' }], edges: [] });
  expect(moved).toContain(a); expect(moved).toContain(b);
  const next = JSON.parse(moved); next.nodes[1].color = '1'; delete next.nodes[1].text;
  const edited = patchCanvasSource(moved, next);
  expect(edited).toContain('"plugin": { "x" : 1 }'); expect(edited).toContain(b);
  expect(JSON.parse(edited).nodes[1]).toEqual({ id: 'a', plugin: { x: 1 }, color: '1' });
  const deleted = patchCanvasSource(edited, { nodes: [JSON.parse(edited).nodes[1]], edges: [] });
  expect(deleted).toContain('"plugin": { "x" : 1 }'); expect(deleted).toContain('"extra": 7');
});
