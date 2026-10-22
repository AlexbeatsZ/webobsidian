import { describe, it, expect } from 'vitest';
import { compileReplacement, expandReplacement, replacementCallback } from './replacement.js';
import { migrateLinterReplacement, migrateLinterReplacements } from './legacyReplacement.js';
import legacy from '../../../tests/fixtures/writing-linter-settings.json' with { type: 'json' };

const replace = (input: string, pattern: RegExp, template: string) =>
  input.replace(pattern, replacementCallback(compileReplacement(template)));
const decodeLegacy = (value: string) => {
  for (const [encoded, decoded] of [
    ['\\f', '\f'],
    ['\\n', '\n'],
    ['\\r', '\r'],
    ['\\t', '\t'],
    ['\\v', '\v'],
    ['\\\\', '\\'],
  ])
    value = value.replaceAll(encoded!, decoded!);
  return value;
};

describe('one LaTeX replacement language', () => {
  it('keeps captured and selected text literal, including placeholder-looking data', () => {
    const result = expandReplacement(
      compileReplacement('[[0]] ${VISUAL} ${1:[[1]]} $0'),
      {
        captures: ['$1\\alpha', 'value'],
        visual: '${2:x}[[0]]',
      },
      true,
    );
    expect(result.text).toBe('$1\\alpha ${2:x}[[0]] value ');
    expect(result.tabstops).toEqual([
      { index: 1, from: 21, to: 26 },
      { index: 0, from: 27, to: 27 },
    ]);
  });
  it('supports named captures, full match, literal dollars and literal backslashes', () => {
    expect(replace('abc', /(?<word>b)/, '${DOLLAR}1:[[<word>]]:${MATCH}:\\n')).toBe('a$1:b:b:\\nc');
    expect(replace('x', /x/, '${1:default}$0')).toBe('default');
    expect(replace('x', /x/, '${LBRACKET}[0]]')).toBe('[[0]]');
    expect(replace('x', /x/, '[[9]]')).toBe('[[9]]');
  });
  it.each([
    ['(x)', '$1$$$&\\n\\\\'],
    ['(?<word>x)', '$<word>/$<missing>'],
    ['(x)', '$10 $01 $00 $99'],
    ['(x)', "$`/$'"],
    ['x', '[[0]] ${MATCH} $0 \\frac'],
  ])('migrates legacy substitutions for %s', (find, replacement) => {
    const pattern = new RegExp(find, 'g'),
      input = 'axbxx';
    expect(replace(input, pattern, migrateLinterReplacement(replacement, find, 'g'))).toBe(
      input.replace(pattern, decodeLegacy(replacement)),
    );
  });
  it('migrates all configured rules once, retaining order and dollar-heavy formulas', () => {
    const migrated = migrateLinterReplacements(legacy);
    expect(migrated.customRegexes).toHaveLength(46);
    expect(migrateLinterReplacements(migrated)).toBe(migrated);
    const input = 'Ａ，text。 ＼ ＄ ［ $ x $\n$$  \\ce{A <=>[$k_+$][$k_-$] B}  $$\n';
    for (let i = 0; i < legacy.customRegexes.length; i++) {
      const before = legacy.customRegexes[i]!,
        after = migrated.customRegexes[i]!;
      const regex = new RegExp(before.find, before.flags);
      expect(replace(input, regex, after.replace)).toBe(input.replace(regex, decodeLegacy(before.replace)));
    }
  });
});
