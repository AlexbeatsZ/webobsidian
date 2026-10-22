# Native tags

Folder-based fixed tags are now configured in Settings → 标签. Automatic create/
session-save additions and the existing-note preview command share this module's
source planner and history. Rule import, ancestor pruning, timing and limitations
are specified in [folder tag rules](folder-tag-rules.md).

## Scope and source inventory

This module replaces only the `multiTag` and `tagWrangler` children of Obsidian
Plus. The checked disposable Vault copy contains Plus **1.3.1**, both flags true,
and no standalone `multiTag`/`tagWrangler` settings object. The source inventory
was read from the local Plus repository's `src/multi-tag`, `src/tag-wrangler`,
core/frontmatter regression sources and `docs/design/tag-wrangler-safety.md`.
The implementation is native source-range operations and application UI; the
plugin runtime, DOM patching and frontmatter serializer were not copied.

`readLegacyTagPreferences` strictly reads the original JSON once when native
per-Vault settings are absent. It imports `modules.multiTag` as `batchEnabled`
and `modules.tagWrangler` as `wranglerEnabled`; malformed JSON/flags report an
error and remain unchanged. Native preferences live in the existing settings
service under the current Vault key. No original plugin file or flag is rewritten.
The coordinator's pinned Plus adapter suppresses only these two child modules
(other separately migrated children have their own adapters), preserving AnyBlock,
STEM references, translation, live references and all original configuration.

## Feature matrix

“Implemented” below describes source implementation and static checks. Runtime,
actual migration and user workflow acceptance are pending.

| Legacy workflow / requested behavior | Native behavior | Boundary |
| --- | --- | --- |
| Multi Tag folder, selected files, search results | One batch dialog accepts explicit file/folder/Vault scope. Existing command/menu callers pass saved paths; folders include descendants. Add, remove and old→new replacement are supported. | Add writes YAML only. Remove changes YAML/inline tags. Replacement also updates matching Tag Page aliases. Shared menu callers are connected by the integration coordinator. |
| Scalar / array / Set normalization | Shared `normalizeStoredTags` handles each explicitly; strings are never spread into characters. | Unknown/non-string values are not invented as tags. Existing invalid source fields are preserved. |
| Await batch writes | Client requests and applies one file at a time, awaiting each revision-checked write or DocumentSession save. Per-file failure remains visible. | No global rollback; local edits remain recoverable in session history if save fails. |
| Tag hierarchy and counts | Existing TagsPanel renders nested tags. A note contributes once per parent and once per exact tag; alias-only Tag Pages have count zero and a page marker. | Counts reflect saved catalog metadata after the existing index event. No unsaved global tag index. |
| Case-insensitive hierarchy rename | Exact canonical tag or slash-descendants match; destination prefix changes while each descendant suffix retains spelling. Case-only renames work. | NFC identity, UTF-16 ranges. Optional exact-only replacement/removal. |
| Merge preview / confirmation | Preview lists every affected file and old/new source patch, plus collisions across saved tags, Tag Page aliases and current browser document overlays. Application requires explicit confirmation. New catalog collisions require a new preview. | Multi-file writes are incremental. Cancellation cannot undo an already submitted file. |
| New / required / excluded search | Existing Search uses `tag:#parent`, `-tag:#parent`; positive filters AND, negative filters exclude descendants. Existing MiniSearch/pinyin handles ordinary terms. | No second engine. Full Obsidian Boolean/parenthesized query grammar is not newly implemented. |
| Tag Pages aliases | All `alias`/`aliases` key case variants contribute through the shared saved catalog. Empty `aliases` does not mask `Aliases: ["#150化学"]`. | Ordinary aliases remain ordinary aliases; only hash-prefixed complete tag aliases create pages. |
| Tag Page open/create | Opens through existing store `openFile`/`openToSide`. No page opens automatically if several files declare the same tag: a chooser lists them. New page writes `aliases: ["#tag"]` and uses exclusive creation. | Suggested filename is visible/editable; the native dialog does not emulate plugin event-based page factories or automatic rename focus. Existing files cannot be overwritten. |
| Alt-click / hover | TagsPanel supports Alt-click and delayed readonly Markdown preview. Shared actions also expose these behaviors for inline/reading/property tag callbacks. | Hover activates only for exactly one saved page. It uses existing document/fragment services, disables plugins/HTML execution and disposes on leave. |
| Tag text drag / hierarchy drop | TagsPanel drags `text/plain` plus a native MIME tag value. Drop suggests `destination/leaf`, then opens the same rename preview. | Self/descendant cycles are rejected; drop never writes immediately. Generic DOM interception is not installed. |
| Sibling collapse / expand | Native tree menu applies folding to siblings of the clicked tag. | State belongs to the panel, not old Obsidian DOM classes. |
| Reading / property / editor context menus | Shared menu actions carry stable `tags.*` IDs and context kind `tag-menu`; coordinator-owned RenderContext callbacks use these exports. | Readonly options omit rename/create; public shares retain their scoped service boundary. No CM-owned text DOM mutation. |
| Smart Random Note / obsolete menu fallback | Excluded as in the consolidated Plus source. | No integration is claimed. |

Native names use Unicode letters/marks/numbers plus `_`, `-`, `/`, reject empty
slash segments and numeric-only names. Other exotic legacy punctuation is not
accepted by native mutation commands. Existing exotic source is not normalized
away by a no-op. Shared Markdown metadata determines which inline forms belong
to the catalog; body-only forms outside that grammar are not promised as targets.

## Ownership and performance

`VaultCatalog` remains the saved metadata owner and `TargetIndex` remains the
resolver. Coordinator-owned metadata changes combine all top-level tag/alias
case variants and invalidate the existing serialized catalog schema. No extra
Vault watcher, metadata database, body cache or independent search index exists.

Tag counts aggregate the current catalog on an existing index generation, not
on typing or a menu open. TagsPanel aborts stale summary requests. The frontend
Tag Page lookup is a small derived map tied to the identity of the existing
`searchEntries()` array; it is discarded when that catalog snapshot changes.
Menus and hover use this lookup. They must not fetch a full tag summary per event.

Explicit maintenance operations narrow saved candidates from the current catalog
and scope first, then read each actual target on demand. Current document overlays
join scoped candidates, including unsaved tags; overlays outside the scope still
participate in merge detection. `DocumentSession.analysis` may be supplied to the
source planner so unopened-file parsing and opened-session parsing use the same
grammar. No keystroke listener scans the Vault. Transient source bodies are
discarded after preview; the bounded 15-minute preview map keeps revision,
ownership, collision and generated-tag markers only, not a second document cache.

## Source preservation and per-file transaction

1. Construct a core `SourceDocument` to map normalized UTF-16 edit positions back
   to original BOM/CRLF/mixed-line-ending source. Reuse core Markdown, metadata,
   formula regions and token-preserving YAML property analysis.
2. Validate the complete target file before returning any patch. Inline tags
   exclude literal code, formula bodies, HTML blocks/tokens, comments, links and
   wikilinks. Top-level tag/alias edits use the shared property patcher; unrelated
   properties and source bytes remain untouched.
3. Invalid YAML, exact duplicate keys, merge keys, target anchors/aliases/tags,
   block values or complex target collections cause the whole file to be skipped.
   A structural patch intersecting a YAML comment is rejected rather than deleting
   the comment. This deliberately skips some valid but complex documents.
4. Reparse the patched property source and compare every intended property value.
   Unexpected token behavior fails closed. Do not call `processFrontMatter` or
   stringify the entire mapping. Same-case duplicate keys are unsafe; differently
   cased keys are each patched independently.
5. Preview returns exact old/new source ranges. The server records target revision
   and local-session ownership. Remote apply rereads current content, checks the
   preview revision, recomputes the patch and writes with `vault.writeFileText`
   compare-and-swap. Existing file-update notifications and Git save scheduling
   remain the owners of index/events and optional autosync.
6. Opened files apply one `DocumentSession.edit` with checked version/revision,
   current captured range text, then await `session.save`. The server also checks
   disk revision before granting local apply. Unsaved edits are included in the
   preview and shared undo history. Clean cached sessions and files opened after
   preview may switch to local ownership only if their source still matches the
   preview revision; changed/dirty/saving/conflicted sessions require a new preview.
   Only dirty and currently visible/open-tab Markdown sessions send full overlays;
   historical clean sessions do not accumulate into the request body.
7. Cancel immediately sets a client stop flag and cancels the server token. It
   prevents the next file from beginning. A write already submitted may finish;
   saved files remain changed. Failures and skipped files are reported, never
   counted as success. The operation does not promise an atomic Vault transaction
   against concurrent external programs or other browsers' unsaved documents.

Vault-change notifications mark old browser sessions stale. Tag preview, apply
and create refuse stale-session use; local apply rechecks the flag after awaiting
its server grant. Existing unsaved documents are kept for recovery rather than
silently cleared or submitted to the newly selected Vault.

The YAML patcher can replace the selected scalar or a selected list range when
the list structure changes. Comments and all bytes outside those necessary target
ranges remain protected; it does not promise identical quote style after converting
a scalar tag list to an array. Tag Page creation uses the existing Vault path and
symlink authorization, exclusive `wx` file creation and original update queue.

## Module map and integration

| Module | Responsibility |
| --- | --- |
| `server/src/services/tags/query.ts` | Names, scalar/array/Set normalization, tag alias extraction, exact hierarchy query filters. Browser-safe pure exports reused by existing search. |
| `source.ts`, `values.ts`, `types.ts` | Source-range planning/validation, transient overlay property extraction and shared data contracts. Browser-safe source planner. |
| `service.ts`, `migration.ts` | Catalog summary, bounded preview/apply/cancel transaction, safe Tag Page creation, read-only legacy preference import. |
| `server/src/routes/tags.ts` | Existing session auth; summary, page, preview, apply, cancel routes. Mounted before broad search routes. |
| `web/src/lib/tags` | Existing request wrapper, stable shared menu contributions, command definitions and transient dialog/hover requests. |
| `TagsPanel`, `TagOperationsHost`, `TagPageHover`, `TagSettings` | Tree, preview/confirmation/progress, readonly fragment hover and controlled settings UI. |

The shared integration contract is maintained in ignored
`.local/feature-integration/tags/integration.md`. App, Settings, command registry,
renderer contexts, file/search menus and plugin adapters belong to the coordinator.
No independent command registry or workspace is introduced.

## Static evidence and pending acceptance (2026-10-22)

- Fresh markdown-core compilation to `.local/feature-integration/tags/build/core`
  succeeded; it does not overwrite package dist or running server assets.
- Full server and web TypeScript checks using those declarations succeeded.
- Isolated Node ESM tag-route bundle and browser tag UI/command bundles succeeded.
  These compile modules only; no service was imported for execution or started.
- `source.test.ts` contains unexecuted regression source for BOM/CRLF/mixed endings,
  comments, unsafe YAML whole-file skips, aliases, exact inline exclusions,
  Unicode hierarchy suffixes, stale captures, session history and awaited saves.
  `service.test.ts` prepares merge confirmation, revision/Vault conflicts, awaited
  writes/cancellation and local-ownership checks with in-memory disposable fixtures.
  Unit/HTTP/UI/browser/Electron/runtime/migration/performance tests were not run.
- Final unified production compilation and shared-hook review belong to the
  integration coordinator. No commit/push is performed by this feature chat.

User acceptance should cover folder/selection/search-result batches; scalar and
list properties; mixed-case keys and `#150化学` Tag Page; case-only rename; hierarchy
merges with confirmed/cancelled choices; cancellation during a delayed save;
conflicting external writes; dirty documents and undo; readonly fragments/public
shares; Alt-click/hover; text drag/drop and sibling folding. Source and build
checks do not establish actual Vault correctness or a measured speedup.
