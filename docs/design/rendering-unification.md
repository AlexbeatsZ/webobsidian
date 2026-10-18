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

- [x] T00: isolated Vitest/Playwright harness and syntax fixtures.
- [x] T01: lossless source coordinate mapping, patches and inverse edits.
- [x] T02: shared document sessions, history, serialized saves, revision conflicts.
- [x] T03: instance-scoped MarkdownView, command focus routing, complete readonly.
- [x] T04: readonly split shares the same renderer and same-file session.
- [x] T05: shared syntax/source model, path semantics, styles and HTML policy.
- [x] T06: br reveal/break behavior, simple HTML and entity positions.
- [x] T07: inline decorations, Unicode tags, lists/tasks, footnotes, source copy.
- [x] T08: media/math/code/HTML blocks and nested callout containers.
- [x] T09: source-preserving YAML properties, explicit source fallback.
- [x] T10: shared table rendering, cell-local edits, range-based structural edits.
- [x] T11: migrate embedded notes/sections/blocks, lifecycle and cycle handling.
- [x] T12: migrate Canvas display/edit, retain JSON source/unknown data, visibility.
- [x] T13: whole-document print/PDF and scoped public-share client; SSR fallback.
- [x] T14: remove unused client pipelines/dependencies and document final limits.

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

## Implementation and remaining acceptance

T00-T14 have a first implementation with automated acceptance. The current suite
covers lossless source/history, local YAML/table edits, shared readonly embeds,
Canvas JSON token patches, full print DOM, scoped share APIs and browser output.
Native IME, touch devices and the operating system print dialog remain manual
acceptance; no running user app was restarted or replaced.

## Implementation map

| Boundary | Main files | Contract |
| --- | --- | --- |
| Raw source and history | packages/markdown-core/src/source.ts, session.ts | LF editor coordinates map to exact original UTF-8 source; inverse patches preserve removed bytes |
| Shared syntax and semantics | syntax.ts, blocks.ts, metadata.ts, links.ts, embeds.ts | Full-source positions, section/block selection, deterministic source-relative paths; ambiguous links never choose arbitrarily |
| Instance engine | web/src/components/MarkdownView.tsx, MarkdownFragment.tsx | Content/mode/services in, source edits/events out; no workspace store or vault API |
| Workspace adapter | Editor.tsx, documents.ts, vaultRenderContext.ts | One file session, independent views, autosave/revision conflicts outside renderer |
| Inline and block presentation | inlineHtml.ts, semanticDecorations.ts, blockLayout.ts, livePreview.ts | Shared CSS classes/tokens for Live/Reading; explicit source region per instance |
| Structured edits | properties.ts, tables.ts | Token/range patches; cell draft commits on leaving cell; unsupported YAML/irregular tables use source |
| Canvas | CanvasMarkdown.tsx, CanvasVisible.tsx, canvasSource.ts | Shared card engine; offscreen cards unmount; only changed JSON tokens for text/geometry edits; exact-source undo |
| Print/PDF | printDocument.ts | Independent readonly full-document host; wait for assets/fonts, freeze DOM, print; no mode switch or fixed delay |
| Public shares | share.ts, shareScope.ts, shares.ts, sharepage.ts | Same reading engine; server grants declared embeds/media only, section boundaries preserved, no authenticated client APIs |
| SSR fallback | server/services/renderhtml.ts, rendercanvas.ts | Retained for crawlers/no JS; shared HTML schema, not a promise of browser-identical server layout |

Fragment hosts carry data-source-from. Their local MarkdownModel positions plus
that base offset identify ranges in the parent document. Embed contexts carry the
embedded note's path, subscriptions and their own ancestry; rendering stops at a
cycle or four levels. Explicit HTML execution is a separate sandboxed capability
for the private vault; shares and print do not receive it.

## Reproducible acceptance

1. Run npm run typecheck and npm run test:unit. The source/session tests cover
   BOM, UTF-16 offsets, mixed line endings, no-op saves, inverse edits, delayed
   saves and revision conflicts. Structured tests preserve quotes/comments and
   unrelated YAML/JSON/table tokens.
2. Set RENDER_TEST_BROWSER to an installed Edge/Chromium executable and run
   npm run test:render followed by npm run test:integration. Both use a dev-only
   double-view fixture and an isolated browser profile, never a live vault.
3. Full-syntax pixel comparison scrolls the same snapshot through four positions;
   caret and editing controls are hidden for the comparison. Other tests assert
   reveal ranges, code literals, lists, nested callouts, readonly dispatches,
   focus routing, copied source, draft updates and cancellation cleanup.
4. The print regression uses 350 paragraphs and verifies the last paragraph,
   every bold span, a rendered break/formula and absence of virtual gaps.
5. For packaged acceptance, build web to Temp/.agents/meta-obsidian-build/server/public
   and compile server to the adjacent dist folder. Run node tests/packaged-rendering.mjs.
   It creates a disposable vault/server, checks SSR + manifest + real client
   Markdown/Canvas + scoped media/password/no-JS boundaries, compares source,
   then stops its own server and deletes its fixture.
6. Manual acceptance: Chinese/Japanese IME at br and task boundaries; real Android
   touch/pinch and keyboard dismissal on Canvas; selection across widgets using
   keyboard/mouse; system print/PDF pagination in supported browsers. Record the
   browser/device/version and exact observed behavior before marking these done.

## Boundaries and rollback

- This establishes one client rendering implementation; it does not implement
  every Obsidian extension or prove every theme/browser visually identical.
- Complex YAML scalars/anchors, duplicate keys and irregular tables retain a
  source entry. Source-mode edits deliberately permit arbitrary Markdown/YAML.
- Fragment-local reference definitions are supported. References/footnotes whose
  definitions live outside a selected embed fragment are not yet imported into
  that fragment. This remains a compatibility follow-up.
- Canvas text/geometry patches retain unrelated source formatting. Array
  insert/delete/reorder reuse exact existing object tokens, retaining unknown
  fields and their spacing; only inserted nodes need serialization. Raw adapter
  replacement preserves mixed line endings between distant changes.
- Full-document print necessarily materializes all content and uses more memory
  than the virtualized editor; unusually large output should be checked manually.
- Revert a delivery commit with git revert; never reset a user's vault. New API
  revision fields are optional for older clients. Deploy server and client from
  the same build so the share manifest and scoped API match. The old client
  pipeline was removed only after its callers were migrated.
