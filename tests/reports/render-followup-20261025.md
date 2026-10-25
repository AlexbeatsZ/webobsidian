# Rendering follow-up: lifecycle ownership

Baseline3006f0c; user requested further inspection and simple tests, not packaging.
Prior0.1.26 remains the last package and does not contain this follow-up.

## Confirmed parent findings

JavascriptRun.renderMarkdown, shared by native scripts and configured effects,
omitted the shared fragment onError callback. A failed React fragment therefore
left the script waiting indefinitely. A late onReady also requested measurement
after run disposal. Original focused tests produced two failures: pending instead
of the failure and one measurement instead of zero.

The existing Module now settles success/failure/abort once, removes its abort
listener on all paths including synchronous mount errors, and ignores late
readiness. No new Interface or separate Adapter, parser/cache/coordinate pipeline.
Locality improves at the existing shared owner rather than patching each caller.
Targeted unit tests14/14 passed (9lifecycle+5code-block recognition); one initial
test incorrectly raced a single microtask, corrected to one task-turn deadline.
The original missing-error failure is independent of that test timing correction.

## Parallel scopes

- Review toolbar/candidate DOM ownership: render-review-lifetime-20261025.md.
- Table cell transitions and image event ownership: render-table-lifetime-20261025.md.
- Parent owns shared docs, final small browser set/typecheck and Git.

Only confirmed scope is patched. Existing asynchronous0.1.26 fixes, source bytes,
Undo, non-executing review contexts and DOM-owned disposal are retained. No claim
of exhaustive rendering correctness, performance gain, native UI/IME/printing or
long-run acceptance. No original Vault/profile/public/install/release changes.

## Final parent acceptance

- Targeted real Edge browser16/16 passed22.3s: three review cases, four table/image
  cases, one actual React failure through JavascriptRun and eight existing
  integration cases. No skips/retries. Source freeze preceded the run.
- Targeted unit14/14 passed; Web typecheck passed. Initial typecheck exposed
  onError declared only on the concrete MarkdownFragment signature, missing from
  shared FragmentOptions. Moved its optional declaration to the shared Interface
  and removed the duplicate; this final type-only change does not alter runtime.
- Review: real equal-Widget DOM transfer leaked cleanup (0 instead of1), and
  quick source switching caused removeChild errors. DOM-owned existing lifetime
  and separate fragment child hosts fix both without changing review decisions.
- Table: reading and superseded cell mounts could commit/reenter after disposal;
  lifetime is invalidated before cleanup and only the active live mount commits.
- Images: actual retained Markdown/HTML image events invoked late measurement;
  resize global handlers survived disposal/error and could write source on mouseup.
  Owner signal removes listeners; active resize is cancelled without writeback.
- Original BOM/CRLF/emoji/source whitespace and Undo are tested. No save writes
  during review probes. Performance claims are limited to no added per-key scans.

Evidence: C:/Users/Meta/AppData/Local/Temp/.agents/render-followup-parent-20261025/browser.log
and the two worker reports. No full suite, new build/package/install, actual network
transfer cancellation, native touch/IME or long-run check. Existing0.1.26 predates
these changes. No unrelated .workbuddy changes.
