# Editing performance

## Ownership follow-up (2026-10-23)

DocumentRegistry owns one autosave timer per session; Editor and Canvas timers
are removed. External notifications read only affected opened sessions and merge
pending refreshes. Selection-only syntax updates retain their early return.
Startup/switch first await the single watcher ready under rebuildFileIndexes,
then build/publish and drain queued changes. See architecture-optimization.md.
Source/diff only: no timings, tests, types, builds or runtime acceptance.

YAML source caches are immutable. yaml Document.clone() retains shared CST token
objects, so mutable formatting callers must parse their own token tree. Reusing
the clone can corrupt subsequent key-sorting/property operations despite leaving
the cached AST's values apparently intact. Nonmutating source reads keep the
bounded existing cache; formatting remains an explicit save operation.

## Contract and verification

Optimize redundant work without changing raw-source preservation, shared document
history, per-view selection, readonly behavior or plugin compatibility. Validation
for this pass is static only: types and isolated production builds. Browser,
Electron, live-vault edits and performance measurements remain user acceptance.

## Index-driven sidebars

The server publishes `index` after derived updates finish. The client coalesces
notifications over 800ms and advances a local generation (server counters may
restart). Backlinks depend on path and generation, never unsaved body text.
Unlinked mentions load only when expanded and reuse the current path/generation
result. Both request chains abort on cleanup and reject stale results. The fetch
API accepts optional AbortSignal arguments without changing existing callers.

## Dependency-aware decorations

Callout formula-source hosting derives ownership from the existing ordered,
nonoverlapping dollar-formula ranges and grammar-preorder containers. A forward
cursor and temporary ancestor stack replace the formula-by-Callout nested loop.
Each candidate Callout is consumed once and pushed/popped at most once, making
this ownership step O(M + C), with O(depth) temporary stack space. A formula must
fit entirely inside bodyFrom..to; crossing an inner boundary can select a valid
outer owner. This uses the existing immutable blockModel cache and preserves its
mathCallout/calloutMath results; selection-only updates do not repeat derivation.
This is a source complexity claim, not measured latency or UI acceptance. No
tests/types/build/probes/app/server/browser or new test cases ran for this change.

Semantic reference definitions, footnote numbering and exclusion lookups are
cached by immutable MarkdownModel identity in a WeakMap. Nested exclusion ranges
use sorted starts and prefix maximum ends. Selection-only updates reuse semantic
items. Layout, math and plugin block fields retain their value for unrelated
transactions; YAML/table fields do not depend on ordinary selection. Relevant
mode/source effects and the frozen IME selection still invalidate decoration.
Block wrappers remain full-document so CodeMirror can measure virtualized layout.

## Plugin metadata

Session metadata is cached by session identity/version; unopened-file metadata
reuses content revision tokens without retaining vault-wide raw text. Positions use one line-start index per parse. Content
events update only their source links. Create/delete/rename events additionally
revisit sources recorded under matching path suffix/basename dependencies,
including previously unresolved links. Host events batch in one serialized queue
and emit one resolved notification per processed batch. Plugin resolution rules
are preserved independently of the shared renderer's stricter ambiguity policy.
The plugin vault caches fallback suffix/basename candidates in existing file order;
content-stat events retain this index while structural sync/rename invalidates it.

## Unified Vault catalog (2026-10-22)

Saved metadata now belongs to VaultCatalog; startup/rebuild enumerate once and
parse each Markdown file once. The link graph and full-text engine consume the
same records. One scoped TargetIndex preserves Markdown-only graph resolution
and all-file resource resolution. See chinese-search.md. No performance numbers
are claimed; static verification only.

## Server link indexes

TargetIndex precomputes NFC/case-normalized exact and suffix candidates, retaining
the existing root/local/suffix precedence and explicit ambiguity. One-shot
resolveTarget stays available without constructing a full index. File/embed
resolution and the note graph share the catalog index with explicit query scopes. The graph maintains
outgoing resolved sets, incoming source sets and lookup-key dependencies;
content edits update one source, path membership changes revisit affected
resolved and unresolved sources. Backlinks read the incoming set directly.

## Source coordinates

SourceDocument stores BOM width and normalized offsets after CRLF sequences,
instead of one raw offset per UTF-16 code unit. rawOffset uses an upper-bound
lookup; bare CR normalizes to LF without adding width. Multiple simultaneous
edits concatenate untouched source slices and insertions once, in source order.
Inverse changes still carry exact removed raw bytes. Predominant line-ending
selection and all public source/session interfaces are unchanged.

## Shared syntax and grammar fragments

DocumentSession exposes lazy analysis and accepts a model from its originating
editor only when path/text match. Saving/conflict-state snapshots reuse the same
version's analysis. MarkdownView receives an optional analysis value and adopts
matching models during external synchronization; it still has no workspace or
vault dependency. CodeMirror edits pass exact old/new change ranges to Lezer
TreeFragment; session undo/external adapters use a bounding text difference.
Initial loads retain full parsing. Metadata and per-view block derivations use
WeakMaps keyed by immutable model identity. Outline/embeds/plugin metadata share
session analysis; fragment caches are scoped to the full parent model and range.
Grammar reuse does not make the complete derived-node traversal incremental.

## Startup index cache (2026-11-02)

The HTTP listener opens only after boot indexing, so `qmd-index.json` restore is
the desktop startup path. The cache used to be written only at boot and accepted
only when every walked stamp matched; any note edited during the previous session
(or pulled by sync) discarded it and re-parsed every note (STEM: 388 notes /
6,581 entries, 17-19s warm, logged 16-28s).

- `loadSearchCache()` reads/parses the saved index and restores its catalog without
  live Vault state; boot starts it before the watcher scan. The full-text index is
  not loaded yet: `QmdEngine.loadMini(json, start)` waits for a gate that opens
  only after the engine is published. Starting the chunked `loadJSAsync` earlier
  starves the walk (one loop turn per awaited stat, one ~12ms index chunk per turn),
  so the listener waited for the whole load anyway (measured 12.3s vs 3.2s).
- While the index loads, the catalog/graph/file tree are current and served.
  `upsertNote`/`remove` update the catalog immediately and keep the latest index
  edit per path in `pending`; the loaded index is installed and `pending` replayed
  in one synchronous step. `search()` and `save()` await `loaded()`. A failed load
  marks the engine unready, so the next search takes the existing rebuild path.
- `rebuildVaultIndex` walks once (siblings stat in parallel, inserted in directory
  order depth-first as before), then applies only differences to the restored
  engine: kind change/missing paths are removed, stamp-changed Markdown is re-read
  and upserted, other entries update their stamp. Failure falls back to a full build.
  A cache for another root is rejected before any index load.
- Nothing is written when nothing changed. Otherwise the save runs 30s later
  (serializing ~50MB blocks the loop ~2s), only if that engine is still published,
  and records the root it was built from.
- Incremental replaces leave stale MiniSearch postings (as runtime edits always
  did), so ranking of lower hits can differ from a fresh build; hit sets match, and
  an unchanged restore matches a fresh build exactly.

Measured on a disposable STEM copy (built server, time to listen): no cache 24-28s;
exact hit 3.7-3.9s (7-11s before this work; 8.5-9.2s with the index load still on
the boot path); 10 edited notes 3.8s (formerly a full rebuild). The search index
finishes about 6s after listening; searches issued earlier (search panel, unlinked
mentions, query blocks) wait instead of failing. Load cost comes from the default
tokenizer keeping whole CJK clauses as terms (`body` 244k + `py_body` 244k of
490k terms for 388 notes); reducing that is a search-design change (chinese-search.md).
The remaining boot path is mostly chokidar readiness (~2.4s, per-directory fs.watch).

## File update pipeline

Vault write/binary/create/copy/rename/remove/trash/restore operations and chokidar
feed one canonical-path queue. It drains latest disk state, serializes each path,
limits concurrent paths to four and reruns when another event arrives in flight.
Markdown reads reuse the existing content revision token; unchanged revisions
skip parsing. Each changed revision is parsed once and fed to search and links
before index/fs notifications. Missing paths remove both indexes. Boot indexing
still uses existing full-build entry points; queues enable only after boot.
Explicit reindex reserves all four workers while replacing the indexes, then
clears remembered revisions so queued events cannot reuse pre-rebuild state.

Content fs events include stat data. Clients patch only the existing file and its
tree ancestors, pass the modify event directly to the plugin vault, and preserve
file-path array/context identity. Structural or unknown paths use the coalesced
full tree refresh. Legacy fs events without stats retain the refresh fallback.
Folder rename/delete queue indexed descendants; watcher events cover new files
appearing concurrently. No time-only suppression can swallow an external write.

## User acceptance

- Type continuously in a long note with backlinks/outline open; unsaved input
  must not issue backlinks/search/matches requests.
- Save and modify other notes externally; backlinks and unlinked mentions refresh.
- Switch notes during delayed requests; old responses must not overwrite the new note.
- Check formula/table/nested-callout source controls, IME and LaTeX Suite `mk`.
- Check shared splits/embeds, undo/redo, exact-source saves and revision conflicts.

No speedup percentage is claimed before measurements on the user's workflow.

## Native writing integration (2026-10-22)

Formula boundaries now come from one cached core source model, reused by live
preview, snippet contexts, delimiter checks and the formatting adapter. TeX trees
are parsed per formula and reused by source/layout features. Safe unrelated
edits map cached regions; structural edits use a full scan. No second Markdown
parser or independent background parser is introduced.

Snippet matching filters string triggers by their last character and uses bounded
source windows where safe; regexes that cannot be proven line-local retain full
prefix semantics. Recursive expansion retains the complete eligible rule list.
Templates and custom regexes compile at configuration load, not on every key.
Capture data is appended literally, and optional prefix/suffix substitutions
read their source lazily. Large spelling data loads on demand. Formatting runs
on explicit saves/commands or configured file changes/paste, never background
autosave. It commits source patches through the shared session history.

These are architectural reductions in repeated work. Runtime throughput, typing
latency and IME acceptance remain unmeasured under the static-only boundary.

## Source controls and editor derivations (2026-10-22 opinions)

The single sourceControls field gives every source entry the same temporary
lifecycle. Properties, formulas, tables, HTML, Mermaid, code processors/native JS
and block effects map their source range through edits and restore presentation
when all selections leave it or focus leaves the view. Nonempty selections use
actual overlap; empty carets include both source boundaries. The same frozen IME
selection is owned by editorSelection and consumed by source controls and all
renderers. Escape and blur reuse forcedRenderedRegion when the caret has no
outside position. Source buttons share transparent normal and
highlighted hover/focus styles; consumers can select a formula's body on entry.

blockModel's existing WeakMap now also retains standalone-comment line membership,
the existing formula-region array and closed single-line dollar formulas grouped
by line. Multiline dollar formulas use block decorations even when their opening
delimiter shares a line with text. Markdown tree/regex decorations exclude TeX
regions; the formula renderer bypasses only that exclusion for its own range.
These facts are derived once
per immutable MarkdownModel, shared across views adopting that model, and reused
for selection/viewport updates. The former buildDecorations scans are removed;
there is no new parser, background job or Vault-wide index.

livePreviewPlugin uses decorationInputsChanged rather than the presence of any
effect. It additionally observes native folds, Callout folds and fenced-HTML
render toggles. Shared dependencies cover document/render context, LaTeX visual
configuration, readOnly/live modes, mapped source/forced-render ranges, block
definitions and the frozen selection. Inline HTML, raw HTML and Mermaid consume
that contract too; table/YAML fields remain independent of ordinary selection
but still react when a source entry closes. Full-document wrappers remain intact.

MarkdownView is the sole installation point for native math visuals, list folds
and contextual list indentation; private writing extensions keep snippets and
their higher key priority. These extensions do not read workspace state or own
another DocumentSession. Formula presentation policy remains in mathPresentation,
and list geometry measurement remains in listLayout.

The first implementation kept an optional lifecycle kind, later renamed
`sourceKind` to avoid collisions with a block's domain `kind`. This left properties
and other fallback entries persistent even though they called the same button
helper. That split failed the requested interaction: shared markup did not mean
shared behavior. The 2026-10-23 correction removes the classifier, close widget,
decoration field and CSS entirely. State stores only `{from,to}` and strips any
domain metadata from direct source spans. Existing callers cannot opt back into
a persistent mode; optional button configuration only controls entry selection.

Executable fenced HTML retains its explicit sandbox execution request. Once
rendered, its sole source entry uses the same field and temporary lifecycle;
there is no separate HTML hide/source toggle. Leaving source remounts the already
requested sandbox. Code processors also use the shared frozen IME selection.
Unsupported YAML/tables still retain their real raw-source fallback rather than
inventing a renderer for structures the app cannot edit.

For this opinions batch the user's latest instruction explicitly forbids tests
and acceptance, overriding the earlier runtime authorization. Only source and
Git diff review were performed for this shared change. No type/build/unit/browser
or app/server checks were run, no test cases were added, and no performance
counts, timings or speedup are claimed. Runtime/UI/IME behavior remains unverified.

## Static evidence (2026-10-19)

- Core compiled to an isolated temporary output; server/web/desktop type checks
  used the resulting declarations, without replacing the live core/server assets.
- Production web build and isolated compiled server/standalone ESM bundle passed.
  Desktop main/preload bundles and their syntax checks passed.
- The standalone relative-require guard passed. All 186 manifest resource files
  exist; the server bundle includes the new source/index/grammar/update pipeline.
- No browser, Electron, server startup, live-vault writes, unit/HTTP suite or
  performance benchmarks ran in this static-only pass. Existing release packages
  were not rebuilt; temporary build artifacts are separate from installed apps.
