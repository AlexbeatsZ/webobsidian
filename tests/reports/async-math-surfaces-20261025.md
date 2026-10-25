# Async math surfaces — 2026-10-25

Worker C owns only `mathTooltip.ts`, `suggest.ts` mathematical selection preview,
`obsidian/runtime.ts` `renderMath` adapter, the dedicated browser spec and this report.
Parent owns integration review, Git, shared design/root documentation and builds.
No stage/commit/build/install or shared CSS/sourceControls/MathWidget edits.

## Confirmed baseline evidence

Edge against actual Vite `/__render-test` on dedicated port 5304; shared MathJax
factory `convertPromise` is gated after sandbox setup, then releases or rejects.
No replacement renderer, queue/cache or production fault hook.

- Tooltip: successful direct `mjx-container` becomes 0 after delayed rejected
  geometry recompute; the original output detaches. Focused red 1/1 fails for this
  actual assertion. Initial broad run counted MathJax's nested SVG and was corrected
  to count direct output containers before the focused reproduction.
- Suggestion selection: ArrowDown switches actual native suggestion; pending and
  failure both leave the preview empty. Red fails visible-error assertion.
- Same selection: ArrowDown wraps a single-item suggestion; existing SVG immediately
  detaches during pending. Focused red fails original-output connectivity assertion.
- Plugin adapter: caller catches `finishRenderMath` rejection, but `unhandledrejection`
  still reports `Error: controlled-surface-failure` from the ignored finally branch.
- Baseline suggestion Escape and tooltip destroy cancellation both pass; late
  rejected work does not mutate their detached output.

Evidence root: `C:/Users/Meta/AppData/Local/Temp/.agents/async-math-surfaces-20261025/`
with `red`, `red-tooltip`, `red-same` output directories and retained failure traces.

## Final implementation contract

- Tooltip retains its immutable-formula SVG and sets `aria-busy` during conversion.
  Cold renders show explicit pending text; an already rendered formula uses the busy
  attribute and named status without extra visible pending text, preserving width.
  Failure displays an error without replacing SVG and allows an ordinary later
  geometry/configuration update to retry.
- Suggestion new item creates a new pending host without the old SVG. Only the
  identical selected equation object and existing host can reuse prior output.
  This is view-local identity, not a formula/output cache. Success remains the
  shared renderer's atomic replacement; failure retains same-item output plus status.
- Both preserve existing controllers/abort checks and tooltip configuration/measure
  lifecycle. No new observer/parser/listener/MathJax queue/cache.
- Plugin adapter attaches fulfillment and rejection cleanup handlers to the original
  promise, avoiding an orphan rejected finally promise. The original promise remains
  in `mathPromises` until settled, so concurrent `finishRenderMath` still rejects.
  Failure is also visible on the returned element; completion tracking is cleared.

## Parent-requested tooltip geometry follow-up

Initial frame measurements confirmed pending text widened the real CodeMirror
tooltip body from 69.71875px to 198.828125px, while SVG stayed 69.71875px.
This was a presentation regression from the first implementation, corrected before
freeze by limiting visible pending text to cold hosts. No CSS, observers, metrics
cache or coordinate adjustment was introduced.

Final native tooltip frames (`accepted/.../native-tooltip-frames.json`):

| State | Frames | Body width | Body height | Left | Original output width |
| --- | ---: | ---: | ---: | ---: | ---: |
| Successful idle | 7 | 69.71875px | 27px | 89.796875px | 69.71875px |
| Delayed recompute | 7 | 69.71875px | 27px | 89.796875px | 69.71875px |
| Failed recompute | 9 | 177.71875px | 27px | 89.796875px | 69.71875px |

Pending has zero width/height/left displacement. The error state grows once to show
the actual diagnostic; no claim of fixed error-state width. All frames keep exactly
one output container. Browser assertions also verify original-node connectivity,
visible/in-viewport native tooltip error, untouched source and zero writes.

## Final validation

- Dedicated spec **11/11 passed, 16.3s**, Edge, one worker, no skips or retries.
  Includes delayed/cold pending, failure visibility, same-formula SVG retention and
  recovery, actual native cursor tooltip and configuration subscription, rapid
  suggestion switching, success/failure cancellation, plugin finish rejection,
  zero orphan `unhandledrejection`, subsequent successful plugin render and drained
  completion tracking.
- Existing `math-inline.spec.ts` **10/10 passed, 18.8s** (body/dark/small/large/quote/
  nested/list metrics, scrolled clicks, source/reading baselines, tall/long formulas).
- `npm --workspace web run typecheck` passed after final product edits on shared tree.
- Owned diff whitespace checks passed. No stage/commit/build/install.
- JSON frame/state evidence is written to test output paths and attached. Inspected
  native retained-error, suggestion-pending and tooltip-pending screenshots. The first
  native fixture put strict-above tooltip near page top; final fixture adds preceding
  paragraphs and explicitly asserts visible/in-viewport instead of claiming the
  earlier off-screen screenshot as visible acceptance.

Final evidence root:
`C:/Users/Meta/AppData/Local/Temp/.agents/async-math-surfaces-20261025/accepted/results/`

Native tooltip subfolder:
`async-math-surfaces-native-5a613-layed-configuration-failure-render/`

Reproduction command (existing compiled core; no build):

```powershell
$env:RENDER_TEST_PORT='5304'
$env:RENDER_TEST_SKIP_CORE_BUILD='1'
$env:RENDER_TEST_BROWSER='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
npx playwright test tests/browser/async-math-surfaces.spec.ts --project=render
```

## Frozen handoff

C's five paths are complete and frozen: three scoped product files, this report and
`tests/browser/async-math-surfaces.spec.ts`. In `obsidian/runtime.ts`, C owns only
the `renderMath` adapter changes (pending text/busy attribute and original-promise
fulfillment/rejection handlers); concurrent B import/MarkdownRenderer hunks are
preserved and do not belong to C. No whole-file replacement or new runtime imports.

Port 5304 has no listener after Playwright teardown. Original Vault/profile,
`server/public`, packages, sourceControls, MathWidget, shared CSS and other owners'
changes were untouched by C. Parent owns final review/Git/shared design/docs/build.
Native `send_input` is not exposed in this worker; ancestor-chat messaging rejected
the attempted update, so the contract/progress/freeze are carried in this owned
report and final return to parent.

No performance claim; only per-request status DOM/identity handling was added.
No installed EXE, physical IME, other platform, long-run or full-suite acceptance.
