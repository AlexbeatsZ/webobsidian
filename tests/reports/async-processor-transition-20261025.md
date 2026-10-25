# Async processor transitions — 2026-10-25

Owner B, starting from f876b44. Source and isolated Edge acceptance only; parent
owns integration documentation, Git closeout and the final build.

## Confirmed causes and corrections

| Surface | Baseline evidence | Correction |
| --- | --- | --- |
| Native query refresh | Eight requestAnimationFrame samples had zero rows after a successful two-row result; height fell to27px, and a failed refresh left no data | Keep the successful list while loading/failing; build one DocumentFragment and replace rows only after a current successful response, including an empty successful result |
| Cold registered processor | Eight samples contained no text and zero height while the processor Promise was unresolved | Compact render status in the existing CodeWidget host; processor-owned synchronous content removes this placeholder; final completion/error removes it |
| Disposed registered processor | Request was aborted but the detached host retained data-render-pending | Register terminal pending/status cleanup on the existing RenderLifetime |
| Public MarkdownRenderer | Rendering twice into one host emitted React's duplicate-createRoot warning; unloading the first owner removed newest output and produced removeChild errors | Each invocation owns a fragment child host and the existing RenderLifetime; a host-local WeakMap tracks the pending and successful owner, so late disposal/callbacks cannot replace another owner's output |
| Configured block effect | Actual installBlockEffects/compiled-script/Vault-modify path yielded eight blank pending frames and discarded successful output after a refresh error | Retain the completed JavascriptRun while the replacement runs; commit after success, preserve prior output after failure, suppress superseded dependency callbacks and dispose both owners at host destruction |
| Native JavascriptBlock | After parent's explicit scope extension, actual installJavascript/compiler/charts-import/watch/execute path reproduced cold and dependency-refresh output empty at0px in8/8frames each | Keep one completed JavascriptRun until replacement success, use local measurable staging and cold status, ignore superseded invalidations and preserve failure retry through the completed run |
| Public synchronous mount failure | Controlled synchronous throw left pending=true,2child candidates and partial failed text next to successful content | Reject then unload the pending RenderLifetime; successful equal-source content remains, pending/candidate DOM is removed and retry succeeds |

Query's existing abort/signal guards already rejected out-of-order success/error
responses in the baseline. Those guards remain the authoritative stale-response
rule; no second generation counter or search cache was introduced.

Public MarkdownRenderer retains an old result only when **both source text and
sourcePath are identical**. A different text or path disposes the previous result
immediately and shows a status, preventing an unrelated document from appearing
to be the new result. Old components only remove their own child host.

## Owners, reuse and staging

Changed production files:

- web/src/lib/obsidian/markdown.ts: CodeWidget.toDOM only.
- web/src/lib/queryBlock.ts: the existing search result update path only.
- web/src/lib/obsidian/runtime.ts: RenderLifetime import, host-local ownership map
  and MarkdownRenderer only. The concurrent worker C math adapter diff in this
  same file is not owned by B.
- web/src/lib/blocks/view.ts: EffectWidget.toDOM only.
- web/src/lib/javascript/runtime.ts: JavascriptBlock.render and its completed-run
  field only, explicitly authorized by parent after the initial scope review.

The existing code registry, RenderLifetime, JavascriptRun, fragment renderer,
search notification lane and DOM-owned disposers remain authoritative. No parser,
Markdown renderer, asset cache, observer, input pipeline or shared CSS was added.
Blocks keep their cleanup/invalidation resources on JavascriptRun; a retained
completed run becomes the dependency owner again after replacement failure, so
the next modify event can retry. Source text is unchanged by render transitions.

Initial public staging used the hidden attribute; parent review identified its
zero-clientWidth risk for MathWidget. Final staging uses local visibility:hidden,
height:0 and overflow:hidden, preserving inline width without showing duplicate
output. These styles live on the public fragment host or a block staging wrapper;
the block script's own container styles remain its own. They are cleared on
commit. No shared mountFragment contract changed.

MarkdownRenderer's Promise still follows the existing editor onReady contract;
asset settlement is checked separately in the browser acceptance, rather than
changing this API into an all-descendants/materialized-document barrier.

## Real Edge acceptance

Environment: installed Microsoft Edge at
C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe, isolated Vite
port5302, fresh Playwright page/context, mocked browser API boundaries and an
isolated search fixture. No live Vault, profile or installed app was used.
RENDER_TEST_SKIP_CORE_BUILD=1 reused the existing compiled core; no build command
or root server/public output was used.

The new async-processor-transition.spec.ts covers thirteen cases:

1. Query's prior rows survive every delayed frame and a failed refresh.
2. Aborted out-of-order success/error cannot replace current rows/status; an
   empty successful response correctly clears prior rows.
3. Query destruction aborts work and suppresses late cancellation/error output.
4. Cold processor has visible status and no bare fenced source; failure stays
   visible and settles pending state.
5. Repeated public rendering has one current owner; unloading an old owner leaves
   the newest output intact, without duplicate-root/removeChild errors.
6. Delayed equal-source replacement retains prior content; failure, cancellation,
   retry and a deliberately late onReady cannot overwrite the newest result.
7. Unrelated prefix edits retain the same processor control DOM and call count;
   native source reveal, actual keyboard typing and Ctrl+Z preserve source.
8. Configured effects retain output during watched dependency rerender, preserve
   data on failure, retry on the next modify event and abort pending/complete runs
   on destruction without showing a cancellation error.
9. Real MarkdownRenderer first mount and equal-source replacement render actual
   MathJax SVG at width>10px, a real table with Header/Cell text, and a decoded
   120px SVG image; pending descendants settle and CM source equals the input.
10. Different source text never shows the old document while the next mount waits.
11. Different sourcePath never shows the old document while the next mount waits.
12. Synchronous mount failure rejects and removes the pending owner/candidate,
    leaves one successful editor and allows a successful replacement retry.
13. Native JavascriptBlock's real compiled trusted script awaits a controlled
    Promise, watches dependency.md through JavascriptRun, retains output on
    refresh/failure, retries on modify, suppresses superseded errors and aborts all
    six executed runs on terminal disposal. Source remains byte-identical input.

Delay/error gates wrap the existing fragment mount only for controlled pending
and failure timing. On release they execute the real mount. The rich-content
case's first mount has no gate: MathJax, table cells and the image actually render.
Table-cell mounts bypass the outer test gate. A visual review caught that the
earlier gate accidentally delayed those nested cells; the strengthened post-
replacement table assertions failed, then passed after correcting this test
fixture. Production table code was not changed. Final screenshots were viewed:
formula, table text and decoded image are present before and after replacement.

Validation results:

- New11 + existing feedback-code-query41: **52/52 passed,56.3s** before the final
  strengthening of post-replacement table assertions.
- Strengthened real-rich-content focused check: **1/1 passed,4.4s**.
- Final strengthened new11 rerun: **11/11 passed,14.0s**.
- Public synchronous-error addition: baseline failed with pending/partial content;
  then the complete new12 suite **12/12 passed,17.8s**.
- Native-JS addition: baseline failed (cold and refresh both blank8/8frames),
  focused correction **1/1 passed,5.6s**.
- Final complete suite including all additions: **13/13 passed,17.0s**.
- Existing architecture lifecycle cases: **3/3 passed,5.5s** (public unload before
  ready, synchronous postprocessor abort and in-flight Component cleanup).
- Web typecheck passed after the final production edits.
- git diff --check passed; Git's LF/CRLF working-copy warnings are informational.

Final delayed samples: query retains2rows/153px in8/8frames instead of0rows/27px;
cold code host displays its compact status at27px in8/8frames instead of blank0px;
public equal-source and configured effect prior outputs remain in8/8frames.
Native JS now shows status at27px during cold load and successful output at27px
during refresh, each8/8frames; baseline both were empty0px.

## Evidence and limits

Temporary evidence root:
C:/Users/Meta/AppData/Local/Temp/.agents/async-processor-transition-20261025-*

- query-baseline/results: query-pending-frames.json, query-pending.png, failing trace.
- baseline/results: processor-cold-frames.json, public duplicate-root failing trace.
- effects-baseline/results: effect-pending-frames.json and failing trace.
- final2/results: 52-case outputs and frame JSON; its early public-rich-ready.png
  precedes the strengthened table assertions and is superseded by rich-final.
- rich-final/results: strengthened public-rich-pending.png/public-rich-ready.png.
- freeze/results: strengthened eleven-case run and frame JSON/screenshots.
- sync-baseline/results: public synchronous throw reproduction.
- freeze2/results: twelve-case final including public synchronous failure cleanup.
- native-baseline/results and native-fixed/results: real compiled-script cold and
  watched-dependency rerender evidence, native-js-frames.json.
- freeze3/results: final thirteen-case complete acceptance including native JS.
- architecture/results: three existing lifecycle cases.

No performance improvement is claimed from a benchmark. The query fix avoids
destructive intermediate list updates; retained effects temporarily keep one
completed and one pending run. Public staging likewise permits one completed and
one pending fragment only for identical source identity.

The native-JS read-only finding became an explicitly authorized scope extension;
it is now fixed and accepted separately above. Interpreter/permissions/chart
implementation and unrelated runtime logic are unchanged. Trusted third-party
code retaining arbitrary DOM references still must cooperate with the supplied
signal/currentness contract; universal arbitrary-code cancellation is not claimed.

On an asynchronous public fragment onError, the prior equal-source complete
fragment remains once, and the failed candidate displays one visible alert below
it. This is an error boundary result, not a second content preview. The regression
asserts one .cm-editor, one visible alert and exact combined text; retry removes
that error candidate and clears the parent error marker. A synchronous mount
throw instead rejects and removes the candidate entirely, preserving the old
equal-source complete fragment without residual pending state.

No staging, commit, build, packaging, installer, release cleanup, original-Vault
write, installed-app restart, native IME or long-duration acceptance was performed.
Mermaid/NoteEmbed, mathematical tooltips/HTML, root AGENTS and design docs remain
with their assigned owners. Parent performs final integrated acceptance/build.
