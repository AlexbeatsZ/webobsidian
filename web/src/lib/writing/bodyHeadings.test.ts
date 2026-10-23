import { describe, expect, it } from 'vitest';
import { markdownAst } from './analysis';
import { compileFormattingSettings, formatText, formatRules } from './format';

describe('body-local titles outside structural formatting', () => {
  const source = '# Top\n#### Gap\n####### Local title!\n###### Next\n## Return';

  it('does not present body titles as ordinary headings to AST-based Linter rules', () => {
    const tree = markdownAst('####### Local title');
    expect(tree.children?.map(n => n.type)).toEqual(['bodyHeading']);
    expect(tree.children?.[0].children?.[0].value).toBe('Local title');
  });

  it.each([false, true])('keeps seven hashes and the following hierarchy intact (startAtH2=%s)', startAtH2 => {
    const option = formatRules.find(rule => rule.alias === 'header-increment')!.options[1].configKey;
    const settings = compileFormattingSettings({ ruleConfigs: {
      'header-increment': { enabled: true, [option]: startAtH2 },
    } });
    const once = formatText(source, 'fixture.md', {}, settings);
    expect(once).toBe(startAtH2
      ? '## Top\n### Gap\n####### Local title!\n#### Next\n## Return'
      : '# Top\n## Gap\n####### Local title!\n### Next\n# Return');
    expect(formatText(once, 'fixture.md', {}, settings)).toBe(once);
  });

  it('also excludes body titles from the common heading capitalization/punctuation matcher', () => {
    const settings = compileFormattingSettings({ ruleConfigs: {
      'capitalize-headings': { enabled: true, style: 'ALL CAPS' },
      'remove-trailing-punctuation-in-heading': { enabled: true },
    } });
    expect(formatText('# ordinary!\n####### Local title!', 'fixture.md', {}, settings))
      .toBe('# ORDINARY\n####### Local title!');
  });
});
