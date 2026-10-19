# Editing performance

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

Semantic reference definitions, footnote numbering and exclusion lookups are
cached by immutable MarkdownModel identity in a WeakMap. Nested exclusion ranges
use sorted starts and prefix maximum ends. Selection-only updates reuse semantic
items. Layout, math and plugin block fields retain their value for unrelated
transactions; YAML/table fields do not depend on ordinary selection. Relevant
mode/source effects and the frozen IME selection still invalidate decoration.
Block wrappers remain full-document so CodeMirror can measure virtualized layout.

## Plugin metadata

Session metadata is cached by session identity/version; unopened-file metadata
reuses unchanged source. Positions use one line-start index per parse. Content
events update only their source links. Create/delete/rename events additionally
revisit sources recorded under matching path suffix/basename dependencies,
including previously unresolved links. Host events batch in one serialized queue
and emit one resolved notification per processed batch. Plugin resolution rules
are preserved independently of the shared renderer's stricter ambiguity policy.

## Server link indexes

TargetIndex precomputes NFC/case-normalized exact and suffix candidates, retaining
the existing root/local/suffix precedence and explicit ambiguity. One-shot
resolveTarget stays available without constructing a full index. File/embed
resolution and the note graph each own a mutable index. The graph maintains
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

## User acceptance

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

## User acceptance

- Type continuously in a long note with backlinks/outline open; unsaved input
  must not issue backlinks/search/matches requests.
- Save and modify other notes externally; backlinks and unlinked mentions refresh.
- Switch notes during delayed requests; old responses must not overwrite the new note.
- Check formula/table/nested-callout source controls, IME and LaTeX Suite `mk`.
- Check shared splits/embeds, undo/redo, exact-source saves and revision conflicts.

No speedup percentage is claimed before measurements on the user's workflow.
