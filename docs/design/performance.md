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

## User acceptance

## Dependency-aware decorations

Semantic reference definitions, footnote numbering and exclusion lookups are
cached by immutable MarkdownModel identity in a WeakMap. Nested exclusion ranges
use sorted starts and prefix maximum ends. Selection-only updates reuse semantic
items. Layout, math and plugin block fields retain their value for unrelated
transactions; YAML/table fields do not depend on ordinary selection. Relevant
mode/source effects and the frozen IME selection still invalidate decoration.
Block wrappers remain full-document so CodeMirror can measure virtualized layout.

## User acceptance

- Type continuously in a long note with backlinks/outline open; unsaved input
  must not issue backlinks/search/matches requests.
- Save and modify other notes externally; backlinks and unlinked mentions refresh.
- Switch notes during delayed requests; old responses must not overwrite the new note.
- Check formula/table/nested-callout source controls, IME and LaTeX Suite `mk`.
- Check shared splits/embeds, undo/redo, exact-source saves and revision conflicts.

No speedup percentage is claimed before measurements on the user's workflow.
