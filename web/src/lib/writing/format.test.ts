import { describe, it, expect } from 'vitest';
import { compileFormattingSettings, formatText, ignoresFormatting, formatRules } from './format';
import legacy from '../../../../tests/fixtures/writing-linter-settings.json';
import { migrateLinterReplacements } from '@webobsidian/markdown-core';
const native = migrateLinterReplacements(legacy);
const now = Date.UTC(2026, 9, 22, 12, 0);
describe('native formatting compatibility', () => {
  it('retains the installed rule inventory and ordered custom replacements', () => {
    expect(formatRules).toHaveLength(65);
    expect(Object.values(legacy.ruleConfigs).filter((r) => r.enabled)).toHaveLength(29);
    const settings = compileFormattingSettings(native);
    expect(settings.customRegexes).toHaveLength(46);
    expect(ignoresFormatting('09插件/rules.md', settings)).toBe(true);
    expect(ignoresFormatting('notes/example.md', settings)).toBe(false);
  });
  it('is stable at a fixed time and preserves legal mhchem math', () => {
    const settings = compileFormattingSettings(native);
    const source = '# Example\n\n$$\\ce{A <=>[$k_+$][$k_-$] B}$$\n\ntext，test。\n';
    const once = formatText(source, 'notes/example.md', {}, settings, now);
    expect(once).toContain('\\ce{A <=>[$k_+$][$k_-$] B}');
    expect(once).toContain('text,test.');
    expect(formatText(once, 'notes/example.md', {}, settings, now)).toBe(once);
  });
  it('shares LaTeX replacements and inserts tabstop defaults without interactive state', () => {
    const settings = compileFormattingSettings({
      customRegexes: [{ enabled: true, find: '(x)', replace: '[[0]]\n\\${1:default}$0', flags: 'g' }],
    });
    expect(formatText('x', 'x.md', {}, settings, now)).toBe('x\n\\default');
  });
  it('does not rewrite documents explicitly excluded by frontmatter', () => {
    const settings = compileFormattingSettings(native);
    const source = '---\ndisabled rules: [all]\n---\ntext，test。  ';
    expect(formatText(source, 'notes/example.md', {}, settings, now)).toBe(source);
  });
  it('protects code from built-in text styling while preserving regex scope', () => {
    const settings = compileFormattingSettings({
      ruleConfigs: { 'strong-style': { enabled: true, style: 'asterisk' } },
    });
    const source = '__bold__\n\n```js\n__code__\n```';
    expect(formatText(source, 'x.md', {}, settings, now)).toBe('**bold**\n\n```js\n__code__\n```');
  });
});
