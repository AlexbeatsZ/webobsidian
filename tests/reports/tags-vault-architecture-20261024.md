# Tags and Vault ownership repair — 2026-10-24

## Scope and source ownership

User authorized implementing the reviewed tags/shared-source and Vault dependency
changes. Initial baseline b81734f; tag relocation was committed separately as
39df16e. Existing parallel navigation/footnote edits are preserved. The shared
core barrel only receives tag exports, and server search only receives query and
vaultFile import changes in this task's staging.

Tag source/folder-rule/type/value modules and existing source tests moved from
Server to markdown-core. All Web and Server callers use the existing shared
packages; the old Server pure modules and query compatibility entry were removed.
Core uses search-core/query, an export of the existing query implementation, to
avoid loading phonetic dictionaries for Markdown-only callers. No logic was copied.

vaultFile now owns existing root/path/symlink, snapshot/read/tree and stat logic.
File updates, Git, search, links and other readonly callers use it directly. Vault
keeps mutations and their indexing/Git side effects, reusing textFile's revision,
UTF-8, atomic and exclusive creation implementation. Rename/copy/remove/trash/
restore no longer rely on HTTP routes to schedule Git. Tag Page creation shares
the Vault writer, preserves its generated preview source, creates exclusively and
awaits indexing. Normal saves do not await indexing. Watcher updates still do not
schedule Git; binary/folder operations retain their existing non-Git behavior.

## Scoped automated verification

Final isolated snapshot: Temp/.agents/tags-vault-architecture-20261024/source,
based on 39df16e plus only this task's pending code. It excludes parallel
navigation source. All test data is newly created under Temp/.agents and removed
by the test fixture cleanup; no original Vault is read or written.

| Verification | Result |
| --- | --- |
| Shared tag source preservation | 16 passed |
| Folder rule planning | 7 passed |
| Data-only folder rule import | 2 passed |
| Tag preview/revision/cancellation ownership | 4 passed |
| Vault operations, save/index timing, exclusive Tag Page creation, path guards and stat cache | 7 passed |
| Real file queue latest-state/revision draining, four-worker limit and full rebuild exclusion | 2 passed |
| Existing text IO revision/source preservation | 1 passed |
| Existing plugin file IO adapter regressions | 3 passed |
| Total | **42/42, 8 files, no skipped tests** |
| Search/core compilation to isolated output | Passed |
| Server and Web TypeScript checks against those declarations | Passed |
| Current shared-tree scoped tests and Server/Web type checks | Passed before isolated closeout; navigation remains independently owned |

Tests use the existing Vitest runner with source aliases. The isolated test run
uses vitest.owned.config.mts in the snapshot. Final configuration includes the
query-only search-core alias and dependency resolution for generated declarations.
Initial checking setup exposed an incorrect SourceSpan import location, missing
Node type roots and missing declaration dependency lookup; all were corrected.
The resulting implicit-any diagnostic was a temporary declaration-resolution
problem, also reproduced without navigation edits, not a navigation source bug.

## Dependency and bundle evidence

- TypeScript AST scan of 343 current Web/Server runtime modules finds no static
  cycles through vault, vaultFile, fileupdates, git, search or links.
- Including literal lazy imports, vault/vaultFile/fileupdates/git have no return
  paths to themselves. This covers the reviewed direct and indirect Vault cycles.
- Existing lazy search → vaultindex → search rebuild delegation remains. This is
  outside the reviewed Vault cycles; no claim that every module cycle is removed.
- Web has zero runtime imports into Server source. Unrelated type-only contracts
  are outside this change.
- Browser-platform bundling of the shared tag entry succeeds: 217 input modules,
  zero Server inputs and zero phonetic dictionary inputs. This is a source bundle
  check, not a production application build or a bundle-size/speed comparison.
- Existing fileupdates code changes only its lower-level import; worker/drain,
  rebuild, revision/index/stat/broadcast and maintenance logic is retained.

## Acceptance limits

No app/server/browser/native-window launch, production build, EXE generation,
packaging, release publication, live Git operation on a Vault, physical IME or
long-running watcher acceptance. Original Vault/profile/settings/processes,
server/public, existing release artifacts and unrelated work are preserved.
No editing-latency or startup-speed improvement is claimed. Existing 0.1.23
artifacts predate these source changes.
