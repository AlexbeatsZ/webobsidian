import { describe, expect, it } from 'vitest';
import { executableSource } from './directive';

describe('explicit JS execution', () => {
  it('keeps examples and configuration inert', () => {
    for (const text of ['', 'chart({});', '// folder-tag-sync-config\n({})', 'const x = 1;\n// @obsidian-js', '// @obsidian-js-suffix\nrun()'])
      expect(executableSource(text)).toBeNull();
  });
  it('recognizes only the first nonempty directive and preserves its body', () => {
    expect(executableSource('\r\n  // @obsidian-js chart\r\nconst x = 1;\r\n')).toBe('const x = 1;\r\n');
    expect(executableSource('// @obsidian-js')).toBe('');
    expect(executableSource('const x = 1;', true)).toBe('const x = 1;');
  });
});
