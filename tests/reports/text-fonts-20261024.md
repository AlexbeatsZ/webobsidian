# Formula text and code Chinese fonts

Date: 2026-10-24 America/New_York. Source baseline:1d10b0c.

## Requested font contract and original reference

The user confirmed that Chinese, ordinary text and equation numbering follow
external prose, while mathematical letters/operators retain mathematical
typesetting. The subsequent code requirement keeps monospace Latin/symbols and
uses Noto Sans SC for Chinese.

The original, read-only
`C:/Users/Meta/Documents/Obsidian/STEM/.obsidian/appearance.json` enables Theme.
Its snippets/Theme.css:3 defines the fallback order
`MathJax_Main, MathJax_Math, Noto Serif SC, serif`. The native `--font-text`
already matches it. The original Vault, enabled snippets and font files were
neither rewritten nor installed as system fonts.

## Confirmed mismatch and final ownership

Chromium CDP `CSS.getPlatformFontsForNode` confirmed the actual painted glyphs:

| Surface | Before | After |
| --- | --- | --- |
| Prose Chinese | bundled Noto Serif SC | bundled Noto Serif SC |
| Bare Chinese inside math | system Noto Sans SC | bundled Noto Serif SC |
| Math `\text{...}` / bold text / quoted display text | system Noto Sans SC | bundled Noto Serif SC |
| Code Latin/symbols | bundled Cascadia Code | bundled Cascadia Code |
| Code Chinese | implicit system fallback | bundled Noto Sans SC |

The root cause was the shared MathJax output's default `unknownFamily: serif`
and ordinary text not inheriting the host font. Declaring the correct prose
CSS stack alone did not remove that independent fallback.

The existing MathJax service now enables `mtextInheritFont` and
`merrorInheritFont`, and points unknown glyph fallback at `var(--font-text)`.
The existing attached-host `readMathMetrics` also captures its effective family
using the same computed-style read as size. The official conversion `family`
option, output/pending cache key, MathWidget and shared tooltip comparisons all
consume that value. Equal TeX/size/width from different font hosts therefore
cannot share the wrong metrics. The one parser/renderer/queue/profile/cache and
existing mount/geometry/config invalidation remain authoritative. No second
stylesheet watcher, SVG rewriting, font setting or live-CSS-reload system exists.

Code uses the existing shared `--font-mono` with Cascadia Code, Noto Sans SC and
the prior monospace fallbacks. A full, unchanged Google Fonts Noto Sans SC variable
TTF (17,772,300 bytes, weights100–900) and its SIL OFL are project assets.
This covers inline, fenced and quoted document code in Live and Reading without
depending on an installed Chinese font. The native source/DocumentSession is
unchanged. Bundled mathematical SVG fonts remain responsible for math glyphs.

## Verification

All execution used
`C:/Users/Meta/AppData/Local/Temp/.agents/meta-obsidian-math-fonts-20261024/source`,
an exact1d10b0c archive plus the owned changes, with existing root/web dependency
junctions and private Vite cache/port5195. Core/search resolve to snapshot source.
Browser: installed Edge, Playwright headless. No root build/public or live Vault.

The four new durable math-fonts.spec.ts cases cover:

- Actual platform glyph fonts for prose versus bare Chinese, ordinary/bold
  formula text, roman Chinese and Callout display math in both views.
- Equal TeX/size/width reopened under fontA/fontB/fontA, with different actual
  text widths and SVG viewBoxes forB and correct cache restoration forA.
  Mathematical SVG paths remain present. This checks concrete host/cache identity;
  arbitrary external stylesheet replacement while a host remains unchanged is
  not a newly introduced reload feature.
- Inline source preview, native numbers, explicit Chinese tags and isolated
  print output using the same prose fallback chain, without source changes.
- Actual bundled Cascadia Code and Noto Sans SC in inline/fenced/quoted code,
  both views; `iiii` and `WWWW` widths agree to4decimal places. Noto Serif SC
  does not paint the code glyphs. Prose, math and code are shown together.

The baseline actual-font test failed as expected on the first Chinese math
glyph, identifying system Noto Sans SC instead of bundled Noto Serif SC. The
shared correction passed all those cases. An early cache test assumed arbitrary
CSS replacement itself requested a new CM measurement; it did not. The test was
changed to the concrete cross-host cache contract without adding an observer.

Web TypeScript passed using snapshot-local core/search source paths and
`tsc --project web/tsconfig.fonts.json --noEmit`, without root dist mutation.

The first complete browser run had71passes and one pixel-equality failure at
scroll500: exactly one pixel differed by2 of255levels at(147,327), while all
common source-line geometry and scroll offsets matched. Trace/PNG/measurements
are retained. Three focused repeats passed without changing its existing
one-level tolerance, retries, product code or assertion. The final complete run
passed72/72 in109.529s, with0skipped,0unexpected and0flaky/retried cases. Own
browser/server exited and port5195 has no remaining listener. The isolated raster discrepancy's cause remains
unconfirmed; no broader rendering/latency claim is inferred from it.

Both formula and combined prose/math/code screenshots were visually inspected.
Raw JSON, screenshots, the failed trace and pixel analysis remain in the Temp
task directory; selected evidence is copied to `.local/text-fonts-20261024`.

## Limits

This is source/type/browser verification. No production compilation, portable
EXE, publication, native Electron window, physical IME or multi-device/long-run
acceptance is claimed. Existing0.1.22 predates both this change and1d10b0c.
Original Obsidian CSS/Vault/profile, running user apps, root server/public,
old release assets and unrelated `.workbuddy` were preserved.

Sources: [MathJax output font options](https://docs.mathjax.org/en/latest/options/output/index.html),
[Google Fonts Noto Sans SC](https://github.com/google/fonts/tree/main/ofl/notosanssc).
