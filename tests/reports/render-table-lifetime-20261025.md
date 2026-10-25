# Table cell render lifetime review — 2026-10-25

Status: **TableWidget + authorized ImageWidget/HTML-image correction frozen;
final four-case browser set passed (7.2 seconds).** No intentionally failing,
skipped or expected-failure regression remains. The parent owns any further
combined review. No build, version change, Git operation or root AGENTS update
was performed.

## Scope and existing owners

- Exclusive source range initially covered `web/src/lib/livePreview.ts`,
  `tableMounts` and `TableWidget`. The parent then explicitly expanded ownership
  to ImageWidget DOM lifetime/load/error/resize and the matching HtmlBlockWidget
  image lifetime. No other livePreview ranges were changed by this worker.
- New files: `tests/browser/render-table-lifetime.spec.ts` and this report.
- `web/src/lib/imagePresentation.ts` now accepts the owning AbortSignal for its
  HTML image load/error listeners. The sole existing caller was migrated.
- Math, Mermaid, NoteEmbed, JavascriptRun, shared CSS, parsers, cache, input and
  fragment-render contracts were not changed.
- Read root AGENTS, rendering-unification, document-media-theme, the relevant
  architecture-optimization/performance sections and coordination records.
- The existing `TableWidget` remains the table owner. `mountMarkdownFragment`
  retains draft editing and teardown; `RenderLifetime` supplies terminal abort and
  late-disposer handling. Core `editTableCell`/`changeTable`, source controls and
  DocumentSession continue to own source patches, source reveal and undo.

## Confirmed table defects and minimal correction

1. Every reading fragment previously received an `onCommit` closure capable of
   changing parent source. The browser adapter probe invoked the reading callback
   with `reading-write`; the source changed from `| value |` to
   `| reading-write |`.
2. Replaced or disposed fragment callbacks had no terminal validity check. A
   disposer invoking its saved callback during table destruction could remount
   reading content recursively. The browser probe failed with
   `RangeError: Maximum call stack size exceeded` at `mount`/`onCommit`.
3. Cleanup already belonged to the mounted DOM through `tableMounts`; that correct
   ownership is retained when CodeMirror substitutes an equivalent WidgetType.
   An array of unguarded cleanup callbacks is replaced by the existing
   `RenderLifetime`. Each cell registers one cleanup for its current fragment;
   each reading/live mount has its own terminal lifetime. Replacement aborts the
   old lifetime before calling its disposer. Commit also invalidates itself before
   disposal/dispatch; repeated and reentrant callbacks are ignored.
4. Only live fragments receive `onCommit`. The parent source-write gate additionally
   rejects a disposed table before reading the view or applying a core patch.
   Drag cleanup is registered with the same table lifetime. No equality/source
   dependency broadening or second render/input system was introduced.

## Browser evidence

Environment: installed Microsoft Edge, Playwright render harness, isolated browser
profile, `http://127.0.0.1:5312/__render-test`. No Vault or running product profile
was opened. Core compilation was explicitly skipped:

```powershell
$env:RENDER_TEST_PORT='5312'
$env:RENDER_TEST_SKIP_CORE_BUILD='1'
$env:RENDER_TEST_BROWSER='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
npx playwright test tests/browser/render-table-lifetime.spec.ts --project=render --reporter=list
```

| Case | Before correction | Table correction result |
| --- | --- | --- |
| Reading/stale live commits | Reading callback overwrote source | Passed: reading callback absent; replaced live callback ignored; current live commit succeeds; every disposer runs once |
| Equal widget + reentrant disposal | Recursive mount/commit, stack overflow | Passed: different equal instances reuse DOM; mounted/disposed counts both 3; disposer/late callbacks cannot change source; repeated destroy is harmless |
| Actual cell editing/source/Undo | Passed | Passed: real click, Ctrl+A, typing, Escape discard, Enter commit, shared reading update, Undo, source reveal and Escape restore |
| Image/HTML load/error and resize | Corrected red probe confirms stale callbacks/global gesture listeners | Passed: zero late measurements or old-DOM writes; HTML equal instance retains cleanup; active gestures cancel without source writes |

The actual edit fixture includes BOM, CRLF, quoted Callout/table prefixes, alignment
tokens, doubled spaces, emoji and no final newline. It asserts the entire original
raw string after Escape/Undo/source restoration, and only `value` → `changed` on
commit. The final screenshot was opened and visually inspected: both views show
the restored table and untouched second cell.

Execution record:

- Initial run: 2 table failures, actual source/Undo pass, and one invalid image
  probe pass; elapsed 8.8 seconds. Raw artifacts: temporary `red/results`.
- After TableWidget patch: all three table cases passed in a four-case run,
  elapsed 7.1 seconds. Its fourth/image pass is **not valid acceptance**.
- Image-probe correction first exposed a test lookup error: `findFromDOM(img)`
  returns null for this image. It must receive the nearest `.cm-editor`.
- Corrected standalone image probe: 1 failed; shell invocation 5.35 seconds,
  Playwright case time 1.6 seconds. Expected
  `{ measures: 0, disconnected: true, destroyed: true }`, actual
  `{ measures: 1, disconnected: true, destroyed: true }`.
- The initial freeze left the confirmed image failure for parent ownership. The
  subsequent explicit authorization expanded this worker to ImageWidget and then
  the matching HTML-image owner, and requested image red/green plus the four cases.
- Expanded image-only red: one failing case, 1.6 seconds case time. Soft assertions
  record all four independent failures: Markdown load measured once after destroy
  and error changed detached DOM; HTML callbacks measured twice after widget
  disposal; source-mode resize disposal retained four global listeners; resize
  error retained those listeners and subsequent mouseup changed source to
  `![picture|100]`.
- First four-case run after the image patch: three table cases passed; a test
  counted one unrelated legitimate editor measurement between two browser RPCs.
  The mounted HTML load/error assertion was moved into the same synchronous
  evaluate as event dispatch, still requiring exactly two calls. No product
  behavior or tolerance was changed to accommodate this fixture timing issue.
- Final authorized four-case run: **4 passed, 7.2 seconds**, no skips, retries or
  expected failures. No typecheck/full suite/build or native launch was run.

Artifacts are under:

`C:/Users/Meta/AppData/Local/Temp/.agents/render-table-lifetime-20261025/`

- `red/results/`: original table failures and traces.
- `green/results/render-table-lifetime-actu-c93f5-and-Undo-preserve-raw-bytes-render/table-source-undo.png`:
  inspected table/source/Undo screenshot.
- `image-owner-probe-2/results/render-table-lifetime-tabl-a8be1-easure-its-destroyed-editor-render/trace.zip`:
  corrected image failure trace.
- `images-red/results/render-table-lifetime-imag-87a72-d-active-resize-on-disposal-render/trace.zip`:
  expanded Markdown/HTML/resize red evidence.
- `images-green-final/results/`: final four-case run, including
  `render-table-lifetime-actu-c93f5-and-Undo-preserve-raw-bytes-render/table-source-undo.png`.
- `image-lifetime-fix.patch`: incremental image/HTML product patch in apply_patch
  format, relative to the initial TableWidget freeze. Source is already applied;
  this attachment is for parent review, not another required application.

## Confirmed image finding and authorized correction

The first image selector accidentally selected CodeMirror's cursor-buffer image,
not `img.cm-embed-image`; its pass was invalid and was corrected before freeze.
The final test selects the actual Markdown image and its nearest cell editor,
replaces the reading cell with live editing, waits for fragment teardown, and
dispatches a delayed load event on the retained image. The image is disconnected
and its editor is destroyed, yet `requestMeasure` is called once.

The original callback was in `ImageWidget.toDOM`:
`img.addEventListener('load', () => view.requestMeasure(), { once: true })`.
ImageWidget previously had no DOM-owned destroy/cancellation counterpart.
The parent explicitly authorized its correction and then the analogous HTML
case. Both now use the same DOM-keyed `imageMounts` WeakMap of existing
RenderLifetime instances. Each destroy removes the mapping and unloads its
lifetime; equivalent WidgetType substitution therefore keeps the mounted DOM's
cleanup. Image load/error/click and resize-handle listeners receive that signal.
HtmlBlockWidget passes its lifetime signal to presentHtmlImages, which registers
both native load/error listeners with it. Aborting actually unregisters those
listeners; no boolean-only callback guard was substituted for cleanup.

Resize retains its existing onMove/onUp and four window listeners. Their removal
is factored into the existing gesture's stopResize closure, registered once with
the mounted lifetime through cancelResize. Destroy and image error cancel it
without calling writeImageWidth; normal mouseup removes listeners before the
existing source-range patch. A new start cancels the previous gesture. Function
identity rejects an obsolete gesture callback without a new input framework.

The expanded browser case also proves active HTML load/error still requests two
measurements, an unrelated tail edit substitutes an equal HTML widget while
retaining its DOM, and disposal cancels the remaining opposite events even though
the parent editor stays alive. Source-mode disposal and active-image error both
leave zero of the four gesture listeners, no old width mutation and identical raw
source after delayed mousemove/mouseup. Missing-image UI still appears and removes
resize handles. No observer, prototype patch or presentation-layer workaround was
added to product code.

This evidence demonstrates a retained event callback and late measurement call.
It does not demonstrate transport-level network cancellation, sustained memory
growth or a visible long-run layout failure. Events were deterministically
dispatched on real rendered image DOM with the actual owners/disposers. Native
touch/touch-cancel behavior and a real network response after teardown were not
accepted. No audio/video or other widget review was performed.

## Performance and freeze boundary

- Table construction remains proportional to mounted cells. Each table and active
  cell mount adds one existing RenderLifetime/AbortController; a cell keeps only
  its current fragment and table cleanup. No global registry/cache/observer or
  per-keystroke work was added.
- Unrelated input still uses the existing table equality and source/math
  dependencies. The equality probe confirms DOM reuse across a tail edit, without
  remounting its three existing fragment mounts. No latency/speedup benchmark is
  claimed.
- Each mounted Markdown image or HTML block adds one existing RenderLifetime
  and signal-bound event listeners. Cleanup is proportional to owned listeners;
  only a current resize gesture keeps four global listeners. No parser, cache,
  observer, per-key measurement or generic rendering framework was added.
- Product modifications are confined to `TableWidget`/`tableMounts`, ImageWidget,
  HtmlBlockWidget image lifetime and presentHtmlImages. The spec, report and Temp
  patch are the other writes. Original Vault/profile, root public,
  releases and workbuddy were not changed. The owned Playwright Vite server has
  stopped and port 5312 has no listener at freeze.
- Source is frozen for parent integration; no known failing case remains in the
  requested four-case regression file. No complete-suite, native Electron, IME,
  OS print, long-run or installed-package acceptance is claimed.
