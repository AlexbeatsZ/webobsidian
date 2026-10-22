import { describe, expect, it } from 'vitest';
import { normalizeMathConfiguration, resolveMathPackages, mathArgumentInfo } from './mathPackages.js';
import { mathBodyOffset } from './mathSource.js';
import { analyzeMarkdown } from './syntax.js';
import { mathRegions } from './math.js';

// Prepared regression source only; runtime execution remains user-deferred.
describe('native math configuration', () => {
  it('resolves package dependencies and rejects ambiguous command providers', () => {
    expect(resolveMathPackages(['siunitx']).map(p => p.id)).toEqual(['cancel', 'color', 'gensymb', 'html', 'siunitx']);
    expect(() => resolveMathPackages(['physics', 'siunitx'])).toThrow('conflict');
    expect(() => resolveMathPackages(['physics', 'braket'])).toThrow('conflict');
    expect(() => resolveMathPackages(['unknown'])).toThrow('Unknown');
  });
  it('accepts Vault macro paths and preserves TeX escapes as source data', () => {
    const preamble = String.raw`\newcommand{\RR}{\mathbb{R}}`;
    expect(normalizeMathConfiguration({ preamble, preambleFile: 'math/macros.tex' }).preamble).toBe(preamble);
    for (const preambleFile of ['../macros.tex', 'C:\\macros.tex', '/macros.tex', '~/macros.tex'])
      expect(() => normalizeMathConfiguration({ preambleFile })).toThrow('Vault-relative');
  });
  it('describes opaque chemistry and unit parameters using shared information', () => {
    const commands = mathArgumentInfo(['mhchem', 'siunitx']);
    expect(commands.ce).toEqual(['chemistry']);
    expect(commands.qty).toEqual(['literal', 'unit']);
    expect(commands.colorbox).toEqual(['literal', 'text']);
  });
  it('projects quote-prefixed source positions into the original TeX body', () => {
    const model = analyzeMarkdown('> $$\n> x + y\n> $$');
    const region = mathRegions(model)[0];
    expect(region.tex).toBe('\nx + y\n');
    expect(mathBodyOffset(region, model.text.indexOf('y'))).toBe(region.tex.indexOf('y'));
  });
});
