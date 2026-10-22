# siunitx-pcc

- Upstream: https://github.com/limefrogyank/siunitx-pcc
- Revision: `ee9f3dc890c13e5e165122bfa7a181680634e183`
- Artifact: `browser/siunitx.js`; Apache-2.0, license retained alongside it.
- This component reuses the host MathJax exports; it does not bundle another engine.
- Local change: omit the two imports which activate upstream's global
  `TexParser.GetBrackets` / `ParseUtil.keyvalOptions` patches. MathJax 4.1.3
  implements these already. Keep this change when updating the vendored artifact.
- Trailing whitespace is normalized; no other upstream behavior is changed.
- Runtime compatibility has not been accepted; current verification is static only.
- This is a partial port: no LaTeX tabular/S columns, no complete siunitx compatibility.
- `physics` and this package both provide `\qty`; selecting both is rejected.
- `mathjax.ts` restores its per-context options and unit maps between conversions.

To update, obtain the browser component and license at a pinned upstream revision,
review the small local patch and the compatibility fixtures in
`docs/examples/math-packages.md`. Never replace the host's parser prototype.
