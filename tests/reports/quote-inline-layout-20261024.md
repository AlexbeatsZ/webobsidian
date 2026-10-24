# Native source-line and inline presentation indentation

Date: 2026-10-24 America/New_York. Baseline: c20625e.

## Reported behavior and confirmed cause

The SCF screenshot has an internal link overlapping the preceding native text.
The Hartree-Fock screenshot has a line-start heading link crossing the Callout's
left frame. The existing disposable Vault contains both exact source sections.
They were read and copied into an isolated test directory; no original note was edited.

Native quote/list lines already use one prefix measurement in `listLayout` and
`prefixWidths`. `lists.css` applies the measured Q/L advances as positive left
padding plus negative first-line indent. The missing ownership boundary was CSS
inheritance: an inline-block link inherited the negative `text-indent` and applied
it again inside its own box. Its border rectangle stayed at the correct source
position while its visible label moved left. Thus a mid-sentence link overlapped
the preceding text and a line-start link escaped the body/frame inset.

Measured label-left minus link-box-left, in CSS pixels, in both Live and Reading:

| Source context | Baseline | Unified layout |
| --- | ---: | ---: |
| Plain paragraph | 0 | 0 |
| Ordinary quote | -18.515625 | 0 |
| Nested quote | -37.015625 | 0 |
| Callout | -18.515625 | 0 |
| Nested Callout | -37.015625 | 0 |
| List continuation | -18 | 0 |
| Quoted list continuation | -36.515625 | 0 |

The same baseline offsets were measured against the preceding text's right edge.
After correction, the preceding-text gap is0 and line-start links align with the
adjacent native body anchor. The external-link arrow retains its intentional width.
No tolerance was enlarged to obtain a pass.

## Final architecture

The existing line-layout stylesheet owns the rule once:

```css
.cm-s-obsidian .cm-line > * { text-indent: 0; }
```

The native source line still applies Q/L first-line indentation. Its direct
element children stop inheriting that indentation, so marks, widgets and nested
presentation all lay out their own contents from zero. This also covers a new
inline renderer without requiring its implementation to know quote/list widths.

Removed nine duplicated reset declarations: bullet, list whitespace, list fold
anchor, list fold button, fold placeholder, quote/list prefix, inline math, block
math and Callout heading. The initial link-only probe was discarded; the final
`livePreview.ts` has no product diff. The only retained resets are an actual flex
Callout **source line**, whose first-line layout intentionally differs, and the
detached math tooltip, a separate surface outside source lines.

Whole-line Table/Math/Mermaid/HTML replacements retain the existing
`sourceBlockReplacement` prefix shell. Callout frame paint retains its independent
owner. No new parser, source-prefix algorithm, widget superclass, state/cache,
observer, measurement pass, pointer/keyboard pipeline or source patch is introduced.
No measured performance improvement is claimed; the change removes per-widget
layout knowledge and adds no JavaScript work to input/selection updates.

## Verification

The isolated snapshot is
`C:/Users/Meta/AppData/Local/Temp/.agents/meta-obsidian-quote-links-20261024/source`.
It uses exact c20625e sources plus the owned changes, existing project dependency
junctions, a private Vite cache and port5196. Core/search imports resolve to the
snapshot's source, avoiding root dist/public mutations. Browser: installed Edge,
Playwright headless. Test data/API routes are isolated from a real Vault server.

Three durable regression cases in `tests/browser/elements.spec.ts` cover:

- Seven contexts x two views x four links: internal and Markdown links at line
  start and after native text, actual text/box geometry, unchanged source bytes.
- Native post-link pointer input and exact inserted source, single Undo,
  caret-driven source reveal/restoration, separate readonly view and navigation,
  with inline/display formulas in the same Callout.
- Quote-inside-list mixed inline presentation at18px/24px: native prefix, bullet,
  fold control, strong/emphasis/code/kbd, both links, math, image and wrapped body.
  The source line retains negative indent while all nested presentation uses zero.

Two additional private tests render the exact copied SCF/Hartree sections with
the copied native MathJax preamble. They expand the original folded Callouts,
capture before/after screenshots and compare actual link rectangles. Both show
the original -18.515625px issue and corrected0px placement; copied source remains
exact. Both corrected screenshots and the SCF before image were visually inspected.

Targeted unified regressions passed. Two initial full related runs had69 passes
and one test-setup failure: the pre-existing elements reset helper used raw file
length as a CodeMirror selection coordinate. The polymer fixture has20CRLFs:
raw length1021 versus normalized editor length1001. The failure was first
suspected to be reset timing; waiting for the requested source did not fix it.
Inspection confirmed the raw/normalized mismatch. The helper now obtains its
coordinate from the existing core `SourceDocument.text`, without a duplicate
normalizer or rewriting the fixture, and waits for requested source readiness.
This changes only test preparation, without sleeps, retries or product behavior.
The final complete run passed70/70 in108.445s, with0skipped,0unexpected and
0flaky/retried cases. It includes the existing related render/theme/prefix/quote,
table/Callout/media/formula/source/input/debug cases plus the three durable
regressions and two private copied-note reproductions. Test browser/server exited;
port5196 has no remaining listener. No unanticipated renderer errors were ignored;
the debug suite retains its explicitly expected controlled-failure checks.

Initial fixture setup also omitted the workspace-local web dependency junction,
which selected root picomatch2 instead of web's existing4; adding the junction
fixed setup without installing or changing dependencies. Earlier new-test DOM
assumptions about CM cursor-buffer siblings and bold-link nesting were corrected
before establishing the red geometric baseline. Failed traces remain in Temp.

## Evidence and limits

Private before/after screenshots are retained under
`.local/quote-inline-layout-20261024/{scf,hartree}-{before,after}.png`.
Raw baseline/final JSON, traces, private source fixtures and copied preamble remain
under the Temp task directory. They are not published as repository fixtures.

This is browser/editor source acceptance. No production build, portable EXE,
release publication, native Electron window, physical IME or long-run performance
acceptance is claimed. Existing0.1.22 predates this correction. Original Vault,
user profile, running user app, server/public, release outputs and unrelated
`.workbuddy` are outside the modified paths.
