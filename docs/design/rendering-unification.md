# Rendering unification

## Accepted contract (2026-10-18)

- Original UTF-8 source is authoritative. Unchanged ranges retain their exact
  whitespace, BOM, line endings, quoting, comments and trailing newline.
- One document session per canonical file; selection, mode, folding and scroll
  belong to individual views. Same-file views share unsaved content and history.
- Views receive content, mode and services; they do not save or read workspace
  globals. Read-only means no user-originated writes, including widgets/commands.
- Editing and reading share syntax, semantics, presentation classes and HTML
  policy. Host spacing may differ. Unfocused syntax stays rendered.
- An empty caret in the inclusive interval `[tag.from, tag.to]` reveals a parsed
  `<br>` tag. Its visual break disappears while source is revealed. Outside that
  interval it renders a break; reading never reveals. Keep the original spelling.
  Nonempty selections do not reveal syntax. Freeze reveal during IME composition.
- Raw HTML is sanitized for display without changing source. Fenced HTML stays
  code; executable HTML previews are a separate capability.
- Table/YAML changes patch source ranges; never serialize an entire structure
  merely to edit one value. Unknown structures retain an explicit source entry.
- Embeds are read-only, carry their own source path, detect cycles, and stop at
  depth 4. Public shares use share-scoped services and server authorization.
- CodeMirror view 6.43.0 supports inline widget `lineBreaks` and `BlockWrapper`;
  use those instead of inventing visual newlines or forcing per-line containers.

## Ordered delivery and acceptance

Each task is committed independently after its checks. Never mark runtime/IME or
device acceptance complete from types/builds or synthetic events alone.

- [ ] T00: isolated Vitest/Playwright harness and syntax fixtures.
- [ ] T01: lossless source coordinate mapping, patches and inverse edits.
- [ ] T02: shared document sessions, history, serialized saves, revision conflicts.
- [ ] T03: instance-scoped MarkdownView, command focus routing, complete readonly.
- [ ] T04: readonly split shares the same renderer and same-file session.
- [ ] T05: shared syntax/source model, path semantics, styles and HTML policy.
- [ ] T06: br reveal/break behavior, simple HTML and entity positions.
- [ ] T07: inline decorations, Unicode tags, lists/tasks, footnotes, source copy.
- [ ] T08: media/math/code/HTML blocks and nested callout containers.
- [ ] T09: source-preserving YAML properties, explicit source fallback.
- [ ] T10: shared table rendering, cell-local edits, range-based structural edits.
- [ ] T11: migrate embedded notes/sections/blocks, lifecycle and cycle handling.
- [ ] T12: migrate Canvas display/edit, retain JSON source/unknown data, visibility.
- [ ] T13: whole-document print/PDF and scoped public-share client; SSR fallback.
- [ ] T14: remove unused client pipelines/dependencies and document final limits.

First milestone is T00-T04, then continue dependent tasks. Excluded from v1:
editable splits/embeds, full plugin compatibility, a new HTML-export product
entry, and complete merger of browser and server output hosts.

## Checks and operating boundary

- Visual: same snapshot, dimensions, font, theme and fold state; wait for assets.
  Mask caret/editing controls only. Assert semantics/ranges as well as pixels.
- Reveal: before/inside/after/leave; nested syntax; nonempty selections; IME.
- Source: no-op save, one-character edit, one-cell/key edit, undo round-trip;
  include UTF-8 BOM, LF/CRLF/mixed endings, emoji and no final newline.
- Isolation: same/different document views, focus, unmount, delayed saves and
  external conflicts; no readonly mutation through menus, keys or widgets.
- Layout: nested blocks/callouts, wrapping lists, asynchronous media, long notes.
- Use temporary test vault/data/output. Do not restart the existing app or build
  over its server/public assets. Browser/device IME acceptance is reported apart.

## Current implementation evidence

Original Editor.tsx owns global content/save and global renderer callbacks;
activeEditor.ts keeps one mounting-based pointer. Split/Canvas use Preview.tsx;
note embeds inside livePreview.ts also use markdown.ts. Table/YAML widgets
reconstruct whole structures. Server file writes originally lack revisions.
The replacement must remove these dependencies incrementally without rewriting
the user's vault.
