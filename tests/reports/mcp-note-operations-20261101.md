# MCP new and renamed notes — 2026-11-01

## Behavior and ownership

Desktop 0.1.41 extends the existing `obsidian_propose_changes` tool with one
`create` or `rename` operation. The six-tool catalog, HTTP/stdio/CLI dispatcher,
persisted review inbox and local acceptance boundary are shared.

- Create shows the exact full candidate source and destination. Submitting
  does not create a note; rejection leaves no file. Acceptance uses native
  exclusive creation and skips new-note templates. Automatic folder tags
  are included in the candidate; changed rules require resubmission.
- Rename shows source and destination and requires the fresh source revision.
  It rejects dirty/conflicted source sessions and existing targets. Native
  DocumentRegistry/store/Vault handle locking, identity/tab remapping,
  catalog notifications and Git scheduling. BOM, mixed endings and content
  bytes are preserved; case-only filename renames are supported.
- A persisted intended operation and exact before/after reconciliation handle
  lost acknowledgements/restarts. Ambiguous states remain recovery_required.
  File operations receive whole-operation decisions; text hunks and text
  recovery keep their existing semantics.
- Physical rename reserves the existing writer queues for both paths and
  checks optional source revision; no second writer/index/parser/review queue.
- The previously implemented local OAuth-discovery JSON404 hotfix is retained
  in this release so packaging does not regress the installed hotfix.

## Validation

- First focused service/writer tests: 24/24 passed.
- First actual backend/browser MCP acceptance: 3/3 passed in 12.8 seconds.
  Requests use real Streamable HTTP MCP tools and an isolated temporary Vault.
  Cases cover exact create bytes, template exclusion, literal candidate
  script display, rename/session/tab remapping, reject, late target collision,
  source revision change and status readback.
- Server/Web typechecks passed; Desktop typecheck passed.
- Working-checkout full unit run: 487/487 in 87 files, including three
  concurrently owned file-placement tests. These are not all MCP release tests.
- Combined MCP/review browser first run: 11 passed/1 failed. The failure was
  a shared mutable expected-error list left by new conflict tests; the next
  unrelated review test incorrectly expected a 409 console error. MCP fixture
  now creates a fresh expected-error list per test.
- Final MCP/context/review browser rerun: **12/12 passed**, 38.0 seconds,
  with zero unexpected renderer errors. Existing per-hunk review, source/
  preview switches, undo and asynchronous embed cleanup remain covered.
- Exact source commit: **7940a6c4d7d7f1e8d11072678ee96abad982ffb6**;
  remote `v0.1.41` tag matches exactly. Native release workflow
  **41285387993** completed successfully on Windows/macOS/Linux.
- CI-built Windows NSIS: **129,832,680 bytes**, extracted executable
  FileVersion **0.1.41**, ProductVersion **0.1.41.0**. Standalone server and
  MCP bundle dependency checks passed. All 16 release assets are uploaded.
- Actual downloaded Windows executable with a new temporary profile/Vault:
  HTTP and packaged stdio (PATH has no Node) each discover six tools.
  Create via HTTP and rename via stdio remain proposals until local UI
  acceptance; exact BOM/mixed-ending/Chinese/emoji bytes match after both.
  Empty-note rejection leaves no file. Status works across transports.
  Both OAuth discovery routes return JSON404. Zero renderer exceptions.
  Evidence: `.local/mcp-note-operations-20261101/packaged/result.json` and
  `packaged-mcp-notes.png`; reusable entry `tests/desktop-mcp-note-operations.mjs`.
- First native harness attempts did not pass: the first assumed a `.main-pane`
  on a fresh Homepage, corrected to wait for the MCP ribbon; another instance
  closed before navigation, with no attributable exit evidence. After adding
  diagnostic capture, the unchanged product completed the entire native
  acceptance. No claim is made about physical long-run stability.
- `v0.1.41` published as a normal, non-draft release with 16 uploaded assets;
  remote tag still points to the exact tested source. Build-only Windows/macOS/
  Linux delivery is distinguished from the bounded Windows native acceptance.

## Scope

All acceptance uses isolated temporary Vault/profile data. Daily Vault,
installed application, connection credentials, proxy configuration and
other devices are untouched. Local MCP acceptance does not establish cloud
Tunnel authentication or receipt by a remote ChatGPT session.

The separate file-defaults/inline-title work is excluded from this feature's
commit and release snapshot; its owner retains the shared working-file hunks.
The pre-existing builtin-MCP investigation report is preserved uncommitted.

## Temporary files

Cleanup of only this task's downloaded/extracted package and three disposable
native fixtures was rejected before execution by automatic approval, with
reason only `blocked by policy`. No retry or alternate deletion was attempted.
Retained under `C:/Users/Meta/AppData/Local/Temp/.agents/`:

- `webobsidian-mcp-notes-041-20261101`
- `mcp-note-package-9DtqfQ`
- `mcp-note-package-H4MQBV`
- `mcp-note-package-a0n0bA`

The isolated executable had exited before cleanup. Original installed
WebObsidian and all unrelated build directories are preserved.
