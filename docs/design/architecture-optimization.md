# Shared ownership follow-up (2026-10-23)

The user approved the nine-work-package review of65ef0c3. This extends existing
owners and removes their bypasses. Source/diff review is the evidence for this
batch: tests, typechecks, builds, fixtures and app/server/browser/device acceptance
remain declined. No package or measured performance result is produced.
Concurrent ordered-marker commit09fb559 is retained.

## Documents and file identity

DocumentRegistry owns one900ms debounce per DocumentSession. Editor/CanvasView
timers are removed. The existing per-session timestamp formatter pauses while
paths change. Central close/navigation and sidebar replacement/close use the
same saveLeaving rule: save, recheck edits/conflicts, then leave; failure retains
the original view. Unmount no longer cancels a retained session's only autosave.

store.renamePath/removePath are the shared orchestration for FileTree rename/drop/
cut, FolderPicker, WorkspaceTabs and plugin Vault/adapter. DocumentRegistry
serializes explicit path operations, waits for pending reads, saves affected
sessions, freezes edits, performs the existing server Vault operation and changes
registry identity. DocumentSession retains source bytes and undo history.
Clean historical destination caches may be invalidated; open/dirty/conflicting
destinations reject. Server rename also rejects an existing different target.

One prefix map updates central/sidebar tabs, split, recents, bookmarks, folders,
navigation history and transient paths, including directory descendants. Plugin
TFile objects follow the move before tree synchronization. Tree responses begun
before path changes are retried. UI-specific rename/close/reload/reopen branches
are removed. The path queue does not enter ordinary keystroke handling.

MarkdownView uses session identity for its lifetime; sidebar hosts use stable tab
ids. Title, syntax identity and navigation bindings change without recreating the
view, preserving independent selection/folds/scroll. Plugin info reads current
RenderContext.sourcePath. Its owned Compartment removes listeners/extensions on
detach; it no longer appends permanent editor-change listeners on rebinding.
Both the editor transaction filter and core session enforce the path edit lock.

Canvas card/edge drafts remain in the existing Canvas owner. pendingCanvasEdits
blocks leaving/path changes and defers external refresh until the draft ends.
Canvas observes the lock and checks before changing state/history. These rules
cover this workspace and its views, not arbitrary external renames or a claimed
cross-process filesystem transaction/rollback.

## External changes

App's existing fs notification refreshes already-open documents before plugin
Vault stat/events. Registry.pending merges reads and drains newer notifications.
It waits for the existing writer without starting another save. A revision change
during read causes a retry, preventing stale reads/self-save echoes from rolling
back acknowledged bytes or creating false conflicts. acceptExternal still owns
dirty-draft protection. Old sessions stop refreshing on vaultSessionStale.
JavascriptRun's widget-only disk refresh is removed; its dependency subscriptions
and invalidation remain. No second watcher/index or polling path is added.

## Configuration and Vault identity

settings.loadSettings initializes only for ENOENT. Existing malformed/unreadable
files and migration persistence failures report errors instead of persisting
defaults. Atomic persistence checks backup errors and removes its temporary file
on failure. Desktop config follows the same missing-versus-invalid distinction.

Property types stay in interoperable .obsidian/types.json. The existing limited
configuration IO and textFile owner provide UTF-8, symlink/Vault/revision checks
and atomic writes. Serial field patches reread the latest source; different-field
stale requests merge only when their own target value is unchanged. A changed
target rejects. Unknown fields, BOM and unaffected text survive; invalid JSON is
not reset. Auto removes the override. The existing watcher emits the same narrow
configuration event for types.json. One frontend snapshot serves all contexts;
request sequence/Vault generation guards reject stale results, and frontmatter
widget equality includes the snapshot even when YAML text has not changed.

vaultPathKey in the existing Vault module is the shared normalized path identity.
Configuration/native-feature tokens keep base64url; workspace names keep hex.
Hotkeys merges equivalent old Windows keys only when overlapping values agree;
conflicts preserve stored state and report an error. First migration also finds
old writing hotkeys across equivalent path keys without rewriting those records.
Linux casing remains distinct.

Desktop startup reads effective server settings. Explicit first/recovery choice
uses the existing WEBOBSIDIAN_INITIAL_VAULT path before clients/indexes exist.
The selected native root is included in startup allowed roots, so explicit local
external-disk choices use the same validator. Cancel creates no default Vault.
The native Switch Vault menu now
opens the existing VaultSettings through vault-switch; the same save/maintenance/
index/watcher flow applies. The hint-only restart path is deleted. Trusted plugin
basePath comes from effective server settings. Existing trusted-mode maintenance
blockers remain.

## Commands and rendering

Format menus call existing editorCommands with the captured EditorView and stale
menu checks. Private wrap/prefixLines are deleted. Checklist and line-style
commands share protected selected-line analysis; explicit surrounding insertion
also serves native code-block insertion. It stays distinct from format toggling.

RenderLifetime is the minimal terminal lifetime shared by JavascriptRun,
code-block hosts and postprocessors: one abort/late-child/late-cleanup rule. Public
Component remains reloadable. Unconditional markdownContext child.load and the
separate JS/code-block guards are removed. Postprocessor entries invalidate on
sourcePath changes, not every RenderContext identity update.

semanticDecorations reuses cached mathRegions so formula source cannot allocate
footnote numbers. Markdown/reference/HTML links use the existing fragment module's
common protocol action. Current-note fragments target the clicked full view;
embeds try their visible range and otherwise use their existing context opener.
No second parser or anchor finder is introduced.

## Index/watcher handoff

Startup and switching reserve the existing rebuildFileIndexes workers, establish
the single watcher and await ready, build/publish catalog/search/graph, then
release/drain the ordinary per-path queue. Events during construction wait in
that queue rather than falling between scan and watcher startup. Polling fallback
carries readiness to its replacement. The full walk tolerates disappearing paths.
Old-root events remain guarded by watcher identity; settings rollback remains the
existing owner. The old observation gap and new ordering are source conclusions;
no runtime race reproduction, stress result or startup speedup is claimed.

## Validation pending authorization

Dirty last-view close/rename/delete, directory moves, multiple views, save failure
and input during saves; clean/dirty external changes, own-save echoes and Canvas
drafts; corrupt configuration/concurrent patches; legacy keys/native cancellation;
format parity/undo; delayed render disposal/embed navigation; index-time changes,
polling fallback and failed switches all remain unexecuted checks. Structural
performance changes are one autosave scheduler per session, targeted refresh and
cached selection-only analysis. No timing or speedup is inferred from source.

## Shared tags and Vault file ownership (2026-10-24)

Tag source planning, folder rules, transient overlay values and declarative data
contracts live in `packages/markdown-core/src/tags`; Web and Server import that
implementation. Core imports the existing query-only search-core export, avoiding
an additional phonetic-dictionary load for Markdown-only consumers. The old
Server pure modules and query compatibility entry are removed. Internal core
imports point directly to existing source/syntax/metadata/math/property owners,
not back through the package barrel. Server keeps preview tokens, Catalog access,
IO and transaction state. No parser, save history or feature state is duplicated.

`vaultFile.ts` owns the existing root/path/symlink checks, source snapshots,
directory/tree reads and stat cache. `textFile.ts` continues to own UTF-8 checking,
revision tokens, per-file write serialization and atomic/exclusive writes. All
read-only callers, including fileupdates, search, links, Git, settings and startup,
use the lower file module. No compatibility reexports remain in vault. This
removes vault/fileupdates and vault/Git cycles, including the search/links return
paths. Existing lazy search/fileindex rebuild delegation to vaultindex is retained;
this change does not claim every possible module cycle was removed.

`vault.ts` owns application mutations and their update/Git effects. Rename, copy,
remove, trash and restore schedule Git after their successful operation; routes
only invoke the operation. Tag Page creation uses the existing Vault text writer,
with exclusive creation, already-prepared source and awaited indexing. Normal
text saves still return without waiting for indexing; initial ordinary notes still
apply folder rules. Binary/folder writes retain their existing non-Git behavior.
Watcher events only enter fileupdates and do not schedule Git.

The single fileupdates queue retains canonical-path/latest-state draining,
four-worker concurrency, full-rebuild exclusion, revision deduplication, one parse
for search/links, stat invalidation, maintenance accounting and watcher handoff.
No new event framework, observer, index or foreground editing work is introduced.
No speedup is inferred from module ownership changes.

Scoped tests cover source-preserving tags, preview/revision safety, native folder
rule import, actual disposable file operations, Tag Page creation timing, stat and
path guards, latest-state drains and rebuild exclusion. Evidence and validation
limits are recorded in tests/reports/tags-vault-architecture-20261024.md.
