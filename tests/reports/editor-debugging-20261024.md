# Editor debug recorder — 2026-10-24

Scope is an explicit local recorder for an intermittent failure that recovered
after page switching. The cause and repair of that original failure are not
claimed. Architecture and retention contract: docs/design/editor-debugging.md.

## Verified behavior

- Existing Settings rows and command registry share one enable/source setting and
  recorder. Default off creates no log directory. Native keyboard/composition,
  selection, mode/source regions, cached math ownership, lifecycle, document save
  state, MathJax requests/results, CM exceptionSink and window/console errors are
  recorded with session/sequence/time. Full source is optional and explicitly
  bounded; snapshots read geometry only on capture, not every input.
- Browser records actual incremental keyboard input, formula source open/Escape,
  a controlled CM plugin failure and a window-error event. It reconstructs the
  exact `> [!tip]\n> body $$x$$` source from its baseline and range patches.
- Page reload restores enabled preference while previously persisted records
  survive. New source-disabled events omit private input. Disabling stops new
  input/periodic logging. The JSONL download and clear-after-stop path work.
- Failed local writes retain buffered records and surface the error. Export still
  contains the buffered source and unsaved count if reading saved logs fails.
  A recovered writer drains the same records without discarding them.
- Four server unit tests pass: absent read/clear creates no directory; concurrent
  appends preserve40 ordered complete JSONL entries; four100-byte generations
  rotate within bounds; an oversized rejected batch does not poison later writes.
- Isolated current-core build and Web/server TypeScript checks pass. Initial
  snapshot type errors came from dependency junctions resolving old root dist;
  snapshot-local core declarations fix the test setup without rewriting root dist.

## Test evidence and boundaries

Uses existing RenderHarness/MarkdownView/DocumentSession, real CM, MathJax, fonts
and CSS in a temporary source snapshot with local Edge/Vite5197. Debug endpoint
requests are mocked for deterministic browser failure/recovery; server log storage
is tested directly. Production server/SPA persistence is checked separately after
packaging. Browser fixture expects only the deliberate controlled plugin exception;
all other console/page errors remain failures.

Early setup failures were corrected: asynchronous checkbox clicks need eventual
state assertions; reset/focus must await the new view; inline rendered math uses
cm-math-rendered and block formula preview owns the source button; an invalid
JSON fixture must declare its Content-Type. Full65-case first run passed64 and
failed one stale shadow assertion still reading the old container instead of the
new painted spacing pseudo-element. It was migrated to the actual paint owner.

Raw results are under Temp/.agents/meta-obsidian-elements-20261024; final run name
results-release-final:65/65passed87.033s,0skipped/0unexpected/0flaky. A prior full
run had one intermittent pixel mismatch at scroll1000; the original trace is
retained, three focused repeats and the final complete run passed without changing
pixel tolerance. Failure-only image/geometry attachments now preserve any recurrence.
Its cause is not asserted. No original Vault/profile/current user window or server/public
was modified. No original exception was captured, and no native/system-IME or
long-running performance acceptance is implied.

## Packaged production resources and release

Exact source b61d4365efa5f888772cea5aa9acec754d341692 was archived into a new
Temp/.agents/meta-obsidian-win-0122-20261024/source. Fresh core/search/Web/server
compilation, desktop bundles/portable package and the packaged standalone guard
passed. Existing dynamic/static import and large-chunk warnings remain build
warnings; they did not prevent compilation or packaging.

The actual packaged server and SPA ran against a separate disposable Vault/data
directory in Edge. Real Settings > 调试 enabled recording; actual typed input and
formula-source/Escape, note switches, command capture/export, reload and disable
were exercised.255 exported records include editor creation/destruction, source
open, math request/result, input/transaction and document state. The real JSONL
file exists in DATA_DIR/debug; enabled preference survives reload, and disabled
preference is verified on disk after the save completes. No runtime page errors.
The first probe sampled the locally toggled checkbox before its asynchronous
preference write completed; the final probe waits for the actual persisted state.

Original12-row table retains18.515625px on both sides. Actual cell input/save changes
only its intended source bytes.1100px image expands the Callout to1137.03125px.
The exact user two-row title and nested frame production screenshot was inspected,
as was the actual Debug settings page. Own browser/server exited; root public
entry size/UTC ticks remain unchanged and the user's existing instance is untouched.

Evidence: .local/editor-debugging-20261024 contains browser-results.json,
production-result.json, production-debug-settings.png, production-title-nested.png
and production-debug-export.jsonl. Original probe/build logs remain in Temp.

Windows x64 portable0.1.22 is85,827,038bytes, PE file/product version0.1.22.
[Release v0.1.22](https://github.com/AlexbeatsZ/webobsidian/releases/tag/v0.1.22)
is published, non-draft/non-prerelease. Exact remote uploaded asset name/size and
tag target b61d4365efa5f888772cea5aa9acec754d341692 were checked. BUILD-INFO.json
records source/package/runtime boundaries. Native EXE window, physical IME and
long-run behavior were not accepted; the original transient cause remains unknown.
