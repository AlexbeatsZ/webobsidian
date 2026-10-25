# Mermaid and note embed asynchronous transitions — 2026-10-25

## Parent follow-up after initial owner freeze

The initial 35-case result below predates two explicit review extensions. Real
narrow embeds with MathJax and six-column tables exposed pending/final width
differences: root296/360px and quote277/360px. Removing absolute positioning and
width100%, using normal-flow zero-height hidden staging, makes host/editor/table/
MathMetrics widths360px both before and after commit. Owner reported2/2 focused
and37/37 adjacent cases passing after this correction.

External-note link previews had the same subscription-refresh clearing pattern.
The confirmed-red delayed actual React mount case lost the old body. The fix is
limited to mountLinkPreview plus RenderLifetime import; existing popup navigation
and nonExecutingContext remain unchanged. Owner reported4/4 initial preview cases
passing and Web types. The source was declared frozen in its status file, but
the worker then hit HTTP429 before final report closeout. Parent takes ownership
of the final combined run; do not interpret initial35/35 as covering these later
changes. See async-render-review-20261025.md for final acceptance.

Owner A completed the MermaidWidget and NoteEmbedWidget scope. Product source is frozen for parent review/build/Git integration. No build, package, install, staging, commit, root AGENTS or design-document edit was performed by this owner.

## Environment and ownership

- Starting source: `f876b44`; only unrelated `.workbuddy/` was dirty at entry. Other owners' later changes remain untouched.
- Windows, installed Microsoft Edge `156.0.4314.42`; Playwright creates its isolated profile. Vite fixture port `5301`, existing `RenderHarness`, no real Vault or account/profile access.
- Existing owners: `livePreview.ts` owns the two widgets; `RenderLifetime` owns terminal cancellation and disposal; `mountMarkdownFragment` owns the same readonly MarkdownView and already exposes onReady/onError; `blockLayout` owns quote/list prefixes and delegates widget DOM updates; existing sourceControls own source editing and Escape.
- Product changes are limited to the two widget sections in `web/src/lib/livePreview.ts`. Exclusive new files: `tests/browser/async-media-transition.spec.ts` and this report. Private status: `.local/opinion-integration-20261022/status-async-media-transition-20261025.md`.

## Confirmed failures before product changes

Real Mermaid output was first allowed to finish. The actual Mermaid runtime render was then delayed before its next invocation while source was edited in the shared DocumentSession. requestAnimationFrame sampled both Live and Reading DOM, SVG presence and height. Root and quoted diagrams both lost successful SVG and shrank from `198px` to the `43px` ellipsis placeholder during the delay.

For embeds, the existing mountMarkdownFragment function was instrumented only in the browser test response to delay actual React mounting; its production implementation and subsequent actual rendering remained intact. Two rapid source-note draft updates were applied. The old embed disappeared before either replacement was ready, with height collapsing to zero. This reproduces the destructive stop/clear-before-mount ordering independently of network timing.

Baseline artifacts are under `C:/Users/Meta/AppData/Local/Temp/.agents/async-media-transition-20261025/red-confirmed2/results/`:

| Probe | Samples | Confirmed defect |
| --- | --- | --- |
| Root Mermaid | 19 frames, 38 host samples | All 34 pending host samples had no SVG; height 43–198px |
| Quoted Mermaid | 19 frames, 38 host samples | All 36 pending host samples had no SVG; height 43–198px |
| Embed refresh | 54 frames, 108 host samples | 104 host samples empty; minimum height 0px; pending marker already absent |

The two initial fixture attempts did not establish product failures: one patched a different Vite module identity and used `strong` rather than CodeMirror's `.cm-strong`; the next resource lookup missed Mermaid after the browser resource-timing buffer filled. The confirmed red run follows correction of those test hooks. The first green run had three assertions reading SVG stylesheet text via textContent; these were changed to inspect `.nodeLabel`. No product change was made for those assertion errors.

## Fix and deleted behavior

Mermaid now keeps its mounted DOM through `updateDOM`. A source change aborts the previous RenderLifetime, starts a fresh render with its own unique hidden stage, and retains the last successful SVG until successful completion. A cold mount uses a short status. A failure uses a short alert and keeps any previous SVG; detailed error information stays in the title. Source controls are recreated from current source ranges, including after text inserted before the diagram. An obsolete successful/rejected render cannot write output or clear the current pending marker. Destruction still removes only the owned render stage and blocks late writes.

NoteEmbed now uses the existing RenderLifetime for the widget plus active/pending fragment mounts, replacing its manual AbortController/cleanup array. Refresh mounts the same existing readonly fragment into a hidden connected staging host. The previous content remains visible until the current fragment's existing onReady callback commits it. Superseded pending fragments are disposed immediately, and late readiness or error callbacks cannot replace current output. Current mount failures retain successful content and show an alert. Missing section and restored-section updates clear pending state and request measurement. The optional absent-renderer branch no longer inserts unhighlighted raw Markdown; it reports a visible error. That fallback was confirmed directly in source, and the unavailable-renderer regression exercises the changed branch.

An extra fault injection after the first freeze found one omission in the new staging code: the last successful active fragment could report a late error while a new fragment was pending, clearing the newer pending state. The controlled test failed with expected2 pending hosts/actual0 under `late-active-error-red`. The error callback now uses the same `pending === render` identity check as onReady. Source was re-frozen after this one guard; the final run below includes this regression. The earlier47.6s run does not represent the final source.

No second parser, renderer, cache, observer, input pipeline, save/history owner, new module, framework or shared contract was introduced. The existing FragmentOptions object carries the already-supported runtime onError callback; shared files are unchanged. MathWidget, HTML, table, sourceControls and blockLayout implementations are unchanged by this owner.

During a pending embed refresh there can be two fragment instances: the last successful visible one and one hidden successor. Superseded successors are disposed, subscriptions remain widget-owned, and no additional scan or measurement loop is introduced. No editing-latency improvement is claimed.

## Verification

Final frozen-source combined run: **35/35 passed in 48.7s**, no skips, retries or unexpected renderer/console errors. It includes all 11 new async-media cases plus 17 existing architecture-render and 7 existing theme-render cases. Earlier focused runs: 11/11 in 19.3s and adjacent 24/24 in 35.5s. Final Web typecheck passed; owned diff whitespace check passed. Final evidence is under `C:/Users/Meta/AppData/Local/Temp/.agents/async-media-transition-20261025/final-frozen/results/`.

| Final frame probe | Samples | Result |
| --- | --- | --- |
| Root Mermaid | 19 frames, 38 host samples | All34 pending samples retain SVG; height198px throughout |
| Quoted Mermaid | 19 frames, 38 host samples | All34 pending samples retain SVG; height198px throughout |
| Embed refresh | 21 frames, 42 host samples | All42 retain old body; 38 correctly marked pending; height54px throughout |

```powershell
$env:RENDER_TEST_PORT='5301'
$env:RENDER_TEST_SKIP_CORE_BUILD='1'
$env:RENDER_TEST_BROWSER='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
$env:RENDER_TEST_OUTPUT_DIR='C:/Users/Meta/AppData/Local/Temp/.agents/async-media-transition-20261025/final-frozen'
npx playwright test tests/browser/async-media-transition.spec.ts tests/browser/architecture-render.spec.ts tests/browser/theme-render.spec.ts --project=render
npm --workspace web run typecheck
git diff --check -- web/src/lib/livePreview.ts tests/browser/async-media-transition.spec.ts
```

New coverage exercises:

- Actual delayed Mermaid render in root and quote wrappers, both modes, per-frame SVG/height retention and exact edit/Undo source preservation.
- Old render success/rejection while a newer render is pending; old finally cannot clear the current pending marker. Current failure retains SVG and recovers on a subsequent source change.
- Actual delayed React fragment mount, two successive draft updates, latest onReady commit, obsolete onReady and old active-fragment error rejection, and both-mode retention.
- Embed destruction with pending readiness; synchronous mount throw and asynchronous onError recovery; missing renderer without raw source fallback; deleted/restored section.
- Native Mermaid source control after an earlier insertion remaps its coordinates, actual keyboard input, Escape and exact Undo. This preserves the existing source editor; the existing Mermaid source mode is plain CodeMirror text, and this task does not claim new Mermaid syntax highlighting.
- A BOM/CRLF parent note remains byte-for-byte equal in raw DocumentSession source during embed updates; no fixture save writes occur.

Existing coverage also passes actual Mermaid font cancellation, simultaneous parse failures, completion after destroy with no orphan stage, context invalidation, actual document/Callout theme colors, long embeds without a scroll cap, readonly fragments, fragment React failure and print preparation.

Frame JSON, screenshots, native source HTML and failure traces remain under the final/red directories above. Pending Mermaid and embed screenshots, before/after SVG retention and native source screenshots were visually inspected. The test-only delayed callbacks are deliberate fault injection around the real browser renderer, not a simulated replacement renderer.

## Delivery boundary

This is source/browser acceptance. Parent owns whole-task final acceptance, documentation, build, packaging and Git integration. No new EXE, installed-app acceptance, physical IME, real Vault writes, native print, other-platform or long-running performance claim is made. Original Vault/profile/public/releases and unrelated `.workbuddy` are preserved. The owned Vite/Edge test processes exit after Playwright; the parent can reuse port5301 after completion.

The current session exposes no native send_input tool. The app messaging tool explicitly rejects native-ancestor messages, so periodic progress/freeze/results were recorded in commentary and the private owner status file instead of attempting further alternate message delivery.
