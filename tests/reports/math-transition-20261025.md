# Formula transitions — 2026-10-25

## Delivery and boundary

- Base: `db54dc651481cbd9d7ffe86498270d78ec505bc7`, `C:/Users/Meta/Project/Workspaces/meta-obsidian`.
- Sole product implementation owner; parent owns independent review/acceptance and root AGENTS/design updates.
- Product source frozen at **2026-10-25 16:24:47 UTC**, before the final specialized and adjacent runs. Later changes are tests, evidence and this report only.
- Product scope: `web/src/lib/livePreview.ts`, `web/src/lib/blockLayout.ts`, `web/src/styles/obsidian.css`.
- New regression: `tests/browser/math-transition.spec.ts`.
- **Final checks: 15/15 specialized + 56/56 adjacent + 5/5 original MathJax = 76 passed; no skips or retries in these final runs.** Web typecheck and `git diff --check` pass.
- No stage, commit, build, package, installer, root AGENTS or design edits. `.workbuddy/` is unrelated and preserved. No live Vault, installed app, user browser profile or existing release was used or changed.

## Confirmed cause before product edits

The existing `MathWidget.toDOM` wrote `this.tex` directly into `.cm-math-body`. Clicking a rendered display formula opens the real highlighted source and creates an asynchronous edit preview. That preview initially painted a second, unhighlighted TeX text node until MathJax completed. Its intrinsic text width could exceed the note column.

The reproduction uses a real pointer click in the existing RenderHarness and a test-only gate around the existing MathJax engine's `convertPromise`. No product instrumentation or alternate conversion path was added. Sampling starts before the click and records every `requestAnimationFrame`, including direct body text, SVG count, pending state, preview identity, width, column edge, highlighted tokens and native selection.

Baseline evidence:

| Observation | Baseline |
| --- | --- |
| Recorded frames | 23 |
| Frames with bare preview TeX | 17 |
| Preview text width | 1355.421875 CSS px |
| Preview right edge | 1453.421875 CSS px |
| Column right edge | 710 CSS px |
| Overrun | 743.421875 CSS px |
| Actual source highlighter | Present in the same frames |
| Preview SVG while gated | 0 |

Artifacts under `.local/math-transition-20261025/baseline/`:

- `baseline-click-frames.json`, extracted unchanged from the baseline trace attachment.
- `results/math-transition-display-cl-3f773-X-in-its-async-edit-preview-render/click-pending.png`.
- The same result directory's `trace.zip` retains the controlled failing baseline.

The gate makes the pending interval deterministic. This establishes the real clicking/presentation path and the offending painted node; it does not claim that every unmodified click naturally remains pending for the measured interval. Final ordinary click cycles also sample intermediate frames without holding conversion.

## Implementation contract and reuse

### MathWidget and DOM lifetime

- Remove the raw TeX placeholder. New display hosts show `正在渲染公式…`; inline hosts show `…`, with an accessible rendering-status label.
- Use CodeMirror's existing `updateDOM` protocol for compatible display mode and source start. The mounted DOM's existing `MathMount` owns the latest widget, abort controller, subscription, measurement and render operation.
- Preserve successful output while the next conversion is pending. `renderMath` still owns SVG creation/cloning and atomically replaces the body only after success. `mathjax.ts`, its queue, caches and cancellation algorithm are unchanged.
- TeX/preview/preceding-definition changes abort the previous subscriber and schedule existing measurement. Number/anchor/control-only updates refresh presentation without reconverting the same formula.
- Rebuild existing source controls against the latest complete source range/body selection. Update/remove equation IDs, numbers and preview classes together.
- Old completion/error/finally callbacks remain guarded by their own aborted signal, so an obsolete request cannot clear a newer pending state or write after destruction.
- On a rejected render, show a visible alert and Retry button with the actual reason in the existing title. Keep any successful SVG alongside the error. Retry reuses the existing measurement/render request; source editing remains the original recovery path. Mathematical parse errors still use MathJax's visible error SVG.

### Shared prefix wrapper

- Multiline quoted display formulas are rendered inside the existing `PrefixedBlock`; their edit previews formerly had a different outer widget type. This prevented old-DOM reuse even after adding `MathWidget.updateDOM`.
- Extract the existing prefix construction into `sourceBlockPresentation`, with two concrete callers: whole-line replacement and a block-formula document preview. The existing cached `blockModel.math` classification chooses whether the preview needs that wrapper; single-line formulas keep their original plain widget shape.
- `PrefixedBlock.updateDOM` delegates a changed compatible content widget's update; equal content updates only the original prefix text. Existing `destroy` still delegates to the current content widget's DOM-owned lifetime.
- No parser, cache, observer, selection/input channel, width compensation or source copy was added. No global overflow clipping or transparent oversized TeX is used. Existing long rendered formulas retain their intended intrinsic overflow.
- The only new CSS styles the real loading/error status. No formula/source positioning or line-height rule changed.

## Final intermediate-frame evidence

Final specialized artifacts: `.local/math-transition-20261025/specialized-final-3/results/`.

| Scenario | Recorded evidence | Result |
| --- | --- | --- |
| Original delayed display click | `click-frames.json`: 25 frames, 50 host samples, 20 pending host samples | 0 bare TeX, 0 missing SVG; original SVG DOM retained during the held preview |
| Display, inline, single-line Callout, multiline Callout | Four `native-click-frames.json` files; four enter/exit cycles each | 0 bare TeX; normal highlighted source/native pointer behavior; delayed first block entry retains old SVG |
| Cold startup, both modes, inline/display/Callout | `cold-frames.json`: 68 frames, 402 pending host samples | Every pending host has a compact status, no SVG yet, no bare TeX or status overflow |
| Configuration invalidation | `configuration-frames.json`: 20 frames, 40 host samples | Existing SVG present in every frame; replacement has the new configuration revision |
| Failed recomputation | `retained-failure-frames.json`: 55 frames, 110 host samples | Old SVG remains present, visible error and successful retry |
| Font size/family/column width update | `font-width-frames.json`: 46 frames, 184 host samples | No missing successful SVG or bare TeX; final geometry changes with the metrics |
| Native source editing and Undo | `source-undo-frames.json` | Native selected TeX and syntax colors, real typing, Ctrl+Z, BOM/CRLF exact restoration, source/reading modes |
| Same-position replacement and overlapping requests | `replacement-race-frames.json` | Latest TeX/anchor/range wins; old finally cannot remove new pending; source button selects the new complete body; numbering-only update preserves existing output |
| Cancellation and unmount | `cancel-frames.json` | Escape restores rendering; destroyed host receives no late body write; replacement document stays correct |

Cold failures and intentionally new formulas are allowed to have no SVG. The zero-missing-SVG assertions apply to existing successful formulas during recomputation, not to cold/new/destroyed hosts.

The short-inline test exposed a real first implementation issue: full-message status width112.96875px versus rendered `$x$` width10.28125px. The final visible ellipsis is18.46875px, reducing the intrinsic width difference from102.6875px to8.1875px. There is no guessed formula-width reservation. Already-rendered formula clicks retain their prior SVG instead of entering this cold status.

The equal-content prefix branch is directly recorded in `prefix-equality-state.json` and `prefix-equality-geometry.json`: changing only the opening-line separator from `> ` to `>\t` leaves inner content equality true and retains its mounted DOM. Prefix advance updates from18.515625px to18px, exactly equals the original prefix element's measured width, and the complete updated geometry equals a fresh mount. Formula source remains unchanged apart from the explicit separator edit.

Viewed screenshots: baseline pending, final delayed click, cold startup, short inline startup, cold failure, and retained-SVG failure. The comparison visibly distinguishes real highlighted editable source from the prior black unhighlighted preview copy.

## Checks and reproducibility

All browser runs use a fresh Vite process on port5301, the existing dev-only RenderHarness, project-local Playwright, installed Edge and an isolated browser context. `RENDER_TEST_SKIP_CORE_BUILD=1` prevents the config's normal core build. No application API/server/live Vault is needed.

```powershell
$env:RENDER_TEST_PORT='5301'
$env:RENDER_TEST_SKIP_CORE_BUILD='1'
$env:RENDER_TEST_BROWSER='C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$env:RENDER_TEST_OUTPUT_DIR='.local/math-transition-20261025/parent-acceptance'
node_modules\.bin\playwright.cmd test tests/browser/math-transition.spec.ts --project=render
```

Final executions:

- Specialized: `math-transition.spec.ts`, **15/15 in25.9s**, output `specialized-final-3/`.
- Adjacent: `elements.spec.ts`12, `quote-origin.spec.ts`6, `prefix-render.spec.ts`8, `math-inline.spec.ts`10, `math-fonts.spec.ts`4, `feedback-equation-number.spec.ts`16: **56/56 in1.5m**, output `adjacent-final/`.
- Existing render cases selected by `MathJax|display formula supports|wrapped lists retain`: **5/5 in9.9s**, output `original-math-final/`. Includes malformed TeX, unsafe links, dynamic local assets, multiline source, wrapped prefixes and delayed unmount.
- Web: `npm --workspace web run typecheck` passes on frozen product source. `git diff --check` passes; only existing LF/CRLF checkout warnings.
- Multiline Callout stabilization: **3/3 in10.4s**, output `callout-stable-final/`, followed by the complete passing15-case run.
- The shared test fixture rejects unhandled renderer/plugin/page/console errors. Final runs do not suppress unexpected errors.

Intermediate failures are retained in earlier output folders. They include the intentional bare-TeX red case, the multiline-wrapper gap, the full inline loading message, and test setup corrections: raw BOM/CRLF length used as CM coordinates; assuming a single SVG for wrapped inline output; expecting the same SVG node after a legitimate successful replacement; and changing every quote separator when the intended equal-content probe must change only the opening line. Initial font/measurement completion is now awaited before taking the click baseline; transient frames after the action remain sampled. No product source changed after the stated freeze.

## Handoff

Parent acceptance: independent frozen-source15/15 in25.0s on5303, Web types pass;
viewed click-pending screenshot showing highlighted native source and retained SVG.
Evidence: Temp/.agents/math-transition-parent-20261025. No new package/install.

- Implementation/test/report ownership is released to parent for independent review and acceptance. No further implementation or test expansion is assigned.
- Root AGENTS and design updates remain parent-owned. In particular, the historical rendering document's statement that failed/pending widgets retain raw TeX is superseded by this contract and needs parent synchronization.
- Port5301 is closed after test teardown. No process kill, live application restart or original-data cleanup was performed.
- This is browser/source evidence. Installed Electron/native IME, OS print, long-run behavior and other platforms are not newly accepted. Print DOM, source preservation and existing intrinsic-overflow regressions are included in the targeted browser checks.
