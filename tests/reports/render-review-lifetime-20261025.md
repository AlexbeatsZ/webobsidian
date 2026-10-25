# Review widget lifetime — frozen handoff, 2026-10-25

## Scope and existing owners

This worker owns only `web/src/lib/review/view.ts`, the new
`tests/browser/render-review-lifetime.spec.ts`, and this report. Source and tests
are complete and frozen for parent integration. No staging, commit, push, version
change, build, installation, shared test, global CSS, or root AGENTS change.
Source baseline at closeout: `3006f0c`; the three owned paths remain unstaged.

Read root AGENTS, `docs/design/native-mcp.md`, the DOM-owned resource and async
sections of `docs/design/rendering-unification.md`, and the RenderLifetime section
of `docs/design/architecture-optimization.md` before implementation.

| Capability | Existing authoritative owner / callers |
| --- | --- |
| Review placement and decorations | `nativeReviewExtension` in `review/view.ts`; `Editor.tsx` installs it for full-note views. Selection-only updates retain the existing field. |
| Review snapshot, decisions and notifications | `review/client.ts`; ReviewToolbar and candidate buttons reuse it. |
| Source normalization, rebase and undo | markdown-core SourceDocument/rebaseReview and DocumentSession; no changes to those owners. |
| React candidate rendering and async cancellation | Existing `RenderContext.mountFragment` / MarkdownFragment / MarkdownView, with their nested embed and MathJax cleanup. |
| Terminal mounted resource ownership | Existing `obsidian/renderLifetime.ts`, following the DOM-keyed WeakMap pattern already used by footnotes and tables. No shared lifetime contract changes. |
| Candidate capability restrictions | Existing `nonExecutingContext`, with block effects disabled; tests verify plugins, scripts, HTML execution, effects and editor binding remain disabled. |

Parent retains the separate `javascript/lifetime.ts` / unit-test changes. Other
workers' livePreview, table/script tests and reports, and existing `.workbuddy`
remain outside this worker's scope.

## Findings and minimal fix

1. **Equal-widget cleanup owner was wrong.** Toolbar stored its React root on
   `this.root`; candidate stored its fragment disposer on `this.cleanup`.
   CodeMirror's `TileCache.findWidget` can retain a DOM node and construct a new
   WidgetTile with a new equal WidgetType. Later destruction calls the new
   widget, which never received those instance fields. Both resources leaked in
   the final real-CM baseline reproduction.
2. **Source toggle reused a still-owned React root.** MarkdownFragment schedules
   React unmount in a microtask. Candidate immediately emptied and repopulated
   that same mount host, so the deferred unmount attempted to remove nodes that
   had already been removed. Real button clicks reproduced `removeChild` errors
   and disappearance of the source `<pre>`.

The fix removes both instance-owned resource fields and the unused Root type.
One module-local WeakMap associates each toolbar/candidate root with the existing
RenderLifetime. `destroy(dom)` removes its entry before unloading, so any equal
replacement widget destroys the resource belonging to that DOM exactly once.
Candidate's current fragment disposer stays in the mounted lifetime's closure.
Every preview draw gets a fresh child mount host; a detached old React root can
finish its deferred unmount without touching the next source or preview host.
The existing fragment disposer remains responsible for nested async cancellation.
An aborted mounted lifetime cannot draw another preview.

No parser, renderer, async queue, readiness contract, timer, observer, keyboard
pipeline, state framework, or global style was added. Equality, source edits,
review decisions and the selection-only shortcut remain unchanged. Added work is
one lifetime/WeakMap entry per mounted root and one child host per preview draw;
there is no added per-keystroke scan. No performance measurement or speedup claim.

## Real-browser evidence

Browser: installed Microsoft Edge, isolated Playwright context, existing dev-only
`/__render-test`, port **5311**, existing compiled core, no actual Vault/server.
Tests use the real MarkdownFragment/MarkdownView, MathJax, DocumentSession,
CodeMirror widgets and DOM. Controlled embedding delays wrap only the existing
renderEmbed service; no replacement renderer is used.

### Red: actual CodeMirror equality transfer

Final fixture has a Callout ending with the reviewed line. A real editor
transaction changes `[!note]` to `[!info]`, causing the existing wrapper rebuild.
The test verifies **both** widget objects changed, both compare equal, both actual
DOM nodes were retained, and each retained DOM's CodeMirror `cmTile.widget` is
the new widget object. It then invokes only `EditorView.destroy()`, never a
widget's destroy method by hand.

Baseline result:

```json
{"selectionUnchanged":true,"equal":true,"reused":true,"transferred":[true,true],"mounted":1,"disposed":0,"toolbarChildren":1,"fragmentEditors":1,"finalDisposed":0}
```

Final result after the fix:

```json
{"selectionUnchanged":true,"equal":true,"reused":true,"transferred":[true,true],"mounted":1,"disposed":1,"toolbarChildren":0,"fragmentEditors":0,"finalDisposed":1}
```

An earlier unrelated-edit fixture did not transfer both actual CM owners and was
replaced. Exploratory manual-destructor probes are excluded from acceptance;
the committed test contains no direct widget.destroy call.

### Red: real preview/source toggle

The unmodified source failed both the normal MathJax candidate and pending-embed
source-switch scenarios. A real 查看源码 click raised:

```text
Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.
The above error occurred in the <FragmentBoundary> component
```

The expected source `<pre>` disappeared. Baseline traces are retained in the
`red` directory noted below. Those two product failures are independent of the
superseded initial equality fixture.

### Green: 3/3, 7.2 seconds

1. Actual CM equal-instance/retained-DOM transfer for both widgets; one fragment
   mount, exactly one cleanup, toolbar React subtree and nested editor removed;
   repeated EditorView destruction does not dispose again. Selection-only changes
   keep the exact field widget objects.
2. Real candidate with MathJax; source/preview and three rapid toggles; red removed
   lines and green candidate return after a conflicting source edit and normal
   DocumentSession Undo. Complete raw source including BOM and CRLF matches the
   original before/after, and the harness records zero saves. Only one current
   preview remains mounted.
3. Real async embedded preview; source switch aborts its first request before
   release, a newer request publishes the current formula and rejects stale
   output, and destruction with a third request pending aborts it before release.
   Final mount/cleanup counts are 3/3; no detached output or nested editor remains.

All three pass the existing automatic pageerror/console-error fixture. No expected
error whitelist was added. Source/preview switching and removal are accepted in
these browser fixtures; full server review acceptance/recovery, physical IME,
native Electron, multi-platform, long-run and whole-suite behavior were not run.

Evidence root:
`C:/Users/Meta/AppData/Local/Temp/.agents/render-review-lifetime-20261025/`.
`red-real-cm-final/results` contains the final actual-CM failure trace;
`red/results` contains the two real toggle failure traces. `green` is the final
three-case run. Tests attach JSON observations as `equal-widget-owners`,
`toggle-undo-source`, and `delayed-preview-lifetime` when reporters retain them.

Reproduce the small set without compiling core:

```powershell
$env:RENDER_TEST_PORT='5311'
$env:RENDER_TEST_SKIP_CORE_BUILD='1'
$env:RENDER_TEST_BROWSER='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
$env:RENDER_TEST_OUTPUT_DIR='C:/Users/Meta/AppData/Local/Temp/.agents/render-review-lifetime-20261025/parent'
npx playwright test tests/browser/render-review-lifetime.spec.ts --project=render --timeout=25000
```

`git diff --check -- web/src/lib/review/view.ts` passes. Vite serves development
sources only; no production build was executed. Port 5311 has no listener after
Playwright teardown. Original Vault, application profile, `server/public`, release
artifacts and `.workbuddy` were not written by this worker. Concurrent owned
changes were preserved. Parent owns the combined small-set acceptance and Git.
