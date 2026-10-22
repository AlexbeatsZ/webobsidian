# MathJax macros and packages

Open Settings → 公式与片段 → MathJax 宏包与自定义命令.
Choose a Vault-relative preamble file or enter a few additional macros, then Save.
The configuration is stored in `.obsidian/webobsidian/math.jsonc` and can travel
with the Vault. Existing plugin files remain untouched.

```latex
\newcommand{\RR}{\mathbb{R}}
\newcommand{\dd}{\mathop{}\!\mathrm{d}}
\DeclareMathOperator{\sech}{sech}
```

Use the `math:reload-config` command to read the selected preamble again. Vault
file events use the same refresh. A failed candidate leaves the last valid
configuration active and reports the error. To override a command deliberately,
use the TeX redefinition command appropriate to the selected package.

## Examples for user acceptance

These are prepared examples, not claims that runtime acceptance has passed.

```latex
\RR^n,\qquad \int_0^1 x\,\dd x
\ce{^{14}_{6}C -> ^{14}_{7}N + e-}
\ce{A <=> B},\qquad \pu{8.314 J mol-1 K-1}
\begin{prooftree}\AxiomC{$P$}\UnaryInfC{$P$}\end{prooftree}
```

Enable siunitx for:

```latex
\num{1.234e5}
\qty{9.81}{\metre\per\second\squared}
\sisetup{per-mode=fraction}
\DeclareSIUnit{\sampleunit}{sample}
\qty{3}{\sampleunit}
```

Physics and siunitx both supply `\qty`; select one. Physics also supplies `\dd`
and several standard operators. To use Physics, disable Braket and review the
personal `\dd` definition. Configure Mathtools through the package-options JSON,
for example `{"mathtools":{"centercolon":true}}`; in-formula `\mathtoolsset`
is disabled to keep configuration changes deterministic.

Acceptance should cover a changed/deleted macro, an invalid preamble, two notes
with earlier same-named definitions, definecolor/DeclareSIUnit state, pending
old output during reload, unit/chemistry input previews, all display hosts and
offline fonts. A macro defined only inside a cursor preview must not become
available in a different formula.

## Adding a real extension

1. Implement the math algorithm using MathJax 4.1.3's native `Configuration`,
   `CommandMap` and parser methods; build MathML nodes and use the host SVG output.
   Prefer the official extension build, externalizing the host core/input modules.
2. Add a component under `web/mathjax/<id>/<file>.js` with its license/provenance.
3. Add one descriptor to `packages/markdown-core/src/mathPackages.ts`, using
   `[webobsidian]/<file>.js`. The asset build uses this same descriptor.
4. Declare real dependencies/conflicts and, optionally, command argument modes.
   Do not reproduce the full semantic parser in metadata. Chemical/unit/literal
   arguments should suppress ordinary snippets and cursor-marker injection.
5. If the package mutates context data outside normal macro definitions, declare
   its `stateCommands` and structured-cloneable `state.options` / `state.data`
   leaves. Dotted data paths checkpoint only the leaf, preserving class methods.
   Review any non-cloneable or global mutations explicitly; never patch the
   shared parser prototype as an installation side effect.
6. Put optional input snippets in the existing snippet source. New code can call
   `require('latex-suite').hasMacroPrefix(prefix)`. No new snippet compiler,
   document store, renderer queue or SVG cache is needed.

The bundled siunitx component is a concrete native extension example. Its
`web/mathjax/siunitx/README.md` records the exact upstream revision and local patch.
Official extension guide: https://docs.mathjax.org/en/v4.0/advanced/build/extension.html

Reading a `.sty` file does not implement a full LaTeX package. Macro definitions
which expand to supported commands work; new drawing/layout/TeX primitives need
an actual implementation. A future full TeX drawing backend remains separate.
