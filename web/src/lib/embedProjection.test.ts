import { describe, expect, it } from 'vitest';
import { DocumentSession, fragmentRange } from '@webobsidian/markdown-core';
import { EmbedProjection } from './embedProjection';
import { nonExecutingContext, type RenderContext } from './renderContext';

function fixture(raw = '\ufeffbefore\r\n\r\n# Part ^heading-part\r\n\r\nbody\r\n\r\n# End\r\nafter', fragment = '^heading-part') {
  const session = new DocumentSession('note.md', raw, undefined, async () => ({}));
  const binding = { session, resolveRange: (model: typeof session.analysis) => fragmentRange(model, fragment) };
  return { session, binding, projection: new EmbedProjection(binding) };
}

describe('source session embed projection', () => {
  it('invalidates a cached snapshot when binding validity changes without a source edit', () => {
    const { session, binding } = fixture();
    let valid = true;
    const projection = new EmbedProjection({ session, resolveRange: model => valid ? binding.resolveRange(model) : null });
    const before = projection.snapshot;
    expect(before.locked).toBe(false);
    valid = false;
    expect(projection.snapshot.version).toBe(before.version);
    expect(projection.snapshot.locked).toBe(true);
    expect(projection.snapshot.text).toBe('');
    expect(projection.snapshot).toBe(projection.snapshot);
    expect(() => projection.edit(before.version, [{ from: 0, to: 0, insert: 'bad' }], 'embed')).toThrow();
    valid = true;
    expect(projection.snapshot.locked).toBe(false);
    expect(projection.snapshot.text).toBe(before.text);
  });
  it('maps deltas, preserves untouched BOM/CRLF bytes and delegates source history', () => {
    const { session, projection } = fixture();
    const original = session.snapshot.raw, at = projection.snapshot.text.indexOf('body');
    projection.edit(0, [{ from: at, to: at + 4, insert: 'edited' }], 'embed');
    expect(session.snapshot.raw).toBe(original.replace('body', 'edited'));
    projection.history(false); expect(session.snapshot.raw).toBe(original);
    projection.history(true); expect(session.snapshot.raw).toBe(original.replace('body', 'edited'));
  });
  it('remaps after preceding source edits and rejects a stale version', () => {
    const { session, projection } = fixture();
    const at = projection.snapshot.text.indexOf('body');
    session.edit(0, [{ from: 0, to: 0, insert: 'prefix\n' }]);
    expect(() => projection.edit(0, [{ from: at, to: at + 4, insert: 'bad' }], 'embed')).toThrow();
    projection.edit(session.snapshot.version, [{ from: at, to: at + 4, insert: 'good' }], 'embed');
    expect(session.snapshot.text).toContain('prefix\nbefore');
    expect(session.snapshot.text).toContain('good');
  });
  it('protects IDs and rejects edits that change section boundaries or structural type', () => {
    const { session, projection } = fixture();
    const at = projection.snapshot.text.indexOf('^heading-part');
    expect(() => projection.edit(0, [{ from: at, to: at + 1, insert: '' }], 'embed')).toThrow();
    expect(() => projection.edit(0, [{ from: 0, to: 1, insert: 'text' }], 'embed')).toThrow();
    const end = projection.snapshot.text.length;
    expect(() => projection.edit(0, [{ from: end, to: end, insert: '# Intruder\n' }], 'embed')).toThrow();
    expect(session.snapshot.version).toBe(0);
  });
  it('fails closed for missing, invalid, conflicting and stopped bindings', () => {
    const { session, projection } = fixture();
    session.setText('deleted');
    expect(projection.writable).toBe(false);
    expect(projection.snapshot.locked).toBe(true);
    expect(() => projection.edit(session.snapshot.version, [{ from: 0, to: 0, insert: 'bad' }], 'embed')).toThrow();
    const other = fixture(); other.projection.stop();
    expect(other.projection.snapshot.locked).toBe(true);
  });
  it('keeps explicit range markers and rejects a newline merge with its end marker', () => {
    const { session, projection } = fixture('before\n\n^range-part:start\n\nbody\n\n^range-part:end\n\nafter', '^range-part');
    expect(projection.range).not.toBeNull();
    const end = projection.snapshot.text.length;
    expect(() => projection.edit(0, [{ from: end - 2, to: end, insert: '' }], 'embed')).toThrow();
    expect(session.snapshot.version).toBe(0);
  });
  it.each([
    ['$$\nx^2\n$$ ^eq-formula', '^eq-formula', 'x^2', 'y^2'],
    ['```js\nconst value = 1;\n```\n^code-example', '^code-example', 'value', 'other'],
    ['> [!note] Title\n> body ^callout-example', '^callout-example', 'body', 'changed'],
  ])('edits typed content while protecting its anchor: %s', (raw, fragment, before, after) => {
    const { projection, session } = fixture(raw, fragment);
    expect(projection.range).not.toBeNull();
    const at = projection.snapshot.text.indexOf(before);
    projection.edit(0, [{ from: at, to: at + before.length, insert: after }], 'embed');
    expect(session.snapshot.raw).toBe(raw.replace(before, after));
    const anchor = projection.snapshot.text.indexOf(fragment);
    expect(() => projection.edit(session.snapshot.version, [{ from: anchor, to: anchor + fragment.length, insert: '' }], 'embed')).toThrow();
  });
  it('strips source editing recursively from nonexecuting embeds', async () => {
    const { binding } = fixture();
    const context = { renderEmbed: async () => ({ path: 'note.md', edit: binding, context, read: () => null, subscribe: binding.session.subscribe }) } as unknown as RenderContext;
    const safe = nonExecutingContext(context);
    const note = await safe.renderEmbed('note', new AbortController().signal);
    expect(note?.edit).toBeUndefined();
    expect((await note?.context.renderEmbed('note', new AbortController().signal))?.edit).toBeUndefined();
  });
});
