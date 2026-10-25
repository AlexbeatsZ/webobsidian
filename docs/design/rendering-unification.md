# Rendering unification

## Formula transition presentation (2026-10-25)

MathWidget never inserts raw TeX as asynchronous presentation placeholder.
Cold mounts show a compact status (ellipsis for inline math). Existing successful
SVG remains while conversion is pending; renderMath replaces the body only on
successful completion. Failures are visible with retry and retain an available
previous SVG. This does not hide or replace the native highlighted source editor.

MathWidget.updateDOM reuses the existing DOM-owned mount for compatible display
kind/source start, updates source ranges/number/anchor/control state, and aborts
obsolete work. Existing queue/cache and measure scheduling remain authoritative.
PrefixedBlock delegates content updates and retains its structural prefix;
whole-line formula previews use the same sourceBlockPresentation as replacement
widgets, including multiline Callouts. No new input, parsing or observer path.

Parent independently ran15/15 transition cases (25.0s) and Web types; worker
adjacent56/56 plus5/5 original math cases passed. Frame sampling covers delayed
conversion, cold/error/retry/cancellation, source edit/Undo and changing metrics.
Report: tests/reports/math-transition-20261025.md. No new installed EXE acceptance.

## Lifecycle and complex rendering (2026-10-24)

The mounted DOM owns footnote cleanup in a WeakMap, so CodeMirror replacing an
equal WidgetType instance does not lose the disposer. Mermaid owns its render
identifier and temporary stage; cancellation is checked after fonts and render
settle, and only that stage is removed. Existing RenderLifetime remains the
terminal owner; Component itself remains reloadable and cleans registrations
arriving after an in-flight load was unloaded. A reload waits for that load.

Public MarkdownRenderer settles on unload or fragment render error instead of
leaving callers waiting forever. Fragment focus, Mermaid fonts, image resize
and table interaction use their owner document. Inline HTML/entity decoration
excludes every existing math range, including unfinished formulas; no parallel
math parser is added.

Postprocessor contexts expose signal/isCurrent/assertActive from the existing
lifetime. Invalidating a document/path/viewport/source mode cancels the current
batch synchronously before scheduling its successor. Cooperative processors
must check this context before late writes. Arbitrary third-party code retaining
DOM references cannot be forcibly cancelled by this contract.

Printing starts one deadline before initial stylesheets, accepts cancellation,
checks styles/images/fonts and fully materializes the same non-executing renderer
before freezing its output. Failure disposes the iframe and mounted fragment.
The operating system print dialog and cross-platform after-print behavior need
native acceptance; DOM preparation tests alone do not establish them.

Evidence and limits: `tests/reports/architecture-20261024.md`.

## Shared ownership follow-up (2026-10-23)

Format menus reuse editorCommands; property types use revision-protected existing
configuration IO and one frontend Vault snapshot, including widget equality.
Math ranges exclude formula source from semantic footnote numbering. Rendered
Markdown/reference/HTML fragment links share fragmentNavigation and the clicked
view. Markdown processors and JS share terminal RenderLifetime; postprocessors
invalidate on sourcePath changes. See architecture-optimization.md for migration,
deletions and pending checks. This follow-up has source/diff evidence only.

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
| Personal local access | server/middleware/localAccess.ts | HTTP and WebSocket share one loopback/Host/Origin predicate; account, API-key and public-sharing runtimes removed at the owner's request |

2026-10-23: Public-share SPA, routes, scope projection, SSR note/Canvas renderers
and their exclusive dependencies are removed. Earlier share/SSR acceptance records
below describe the former implementation. They do not describe the current
runtime; Print/PDF and ordinary readonly fragments retain their shared client
renderer and non-executing context.

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

- 2026-10-19 performance pass: source coordinates use sparse CRLF/BOM differences
  and multi-range edits concatenate untouched raw slices once. Exact inverse
  source is retained. See performance.md; verification remains static only.
- DocumentSession.analysis is lazy and shared by view/outline/embed/plugin
  adapters. MarkdownView optionally receives this immutable model; local edits
  reuse Lezer grammar fragments and return the resulting model to the session.
  Source/metadata ranges still cover the full document. No viewport-only parser
  or asynchronous stale syntax is introduced.

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

## Default document theme (2026-10-18)

- The STEM editing view is the typography reference: MathJax_Main / MathJax_Math /
  Noto Serif SC at 18px; Cascadia Code for code. UI fonts remain independent.
- Font faces are extracted from the user's STEM snippets into assets/fonts and
  imported through fonts.css. There is no local() dependency on system fonts.
- Existing theme definitions are replaced in place, without a user-theme override
  layer. Light/dark surfaces, gray highlights, dark bold weight, 3px quote rules,
  neutral bordered callouts and their colored title rules are shared by all clients.
- H1–H6 labels and fold controls share an inline first-line anchor, independent
  of source-marker reveal and heading block padding. The old bottom-anchored line
  pseudo-label is removed; native heading foldService/ranges remain authoritative.
- Custom proof/think/tactic and attention color/icon slots belong to callouts.ts.
- Callout headers have a dedicated `callout-title` block wrapper. The 3px rule
  belongs to that container with `top: 0; bottom: 0`; the 8px body gap is measured
  padding on the body wrapper, never a title margin or pseudo-element height adjustment. Icons center on the complete title,
  including wrapped lines; CM retains its inline text and caret ownership.
- proof/think/tactic use the unmodified Lucide v0.263.1 check-circle, lightbulb and
  file-signature SVG assets, with source/version/license in assets/icons/lucide.
  Do not substitute approximate paths. Trailing fold controls stay outside the
  collapsed-body replacement (noninclusive start).
- Remaining image/embed/Mermaid presentation: see document-media-theme.md.
  Hider workspace changes are separate. Bundled Chinese fonts retain full coverage;
  font subsetting/compression is not part of this change.

Theme acceptance: web typecheck, isolated production build and 26 Edge browser tests pass.
Pixel parity permits at most one 8-bit channel level of rasterization rounding;
font readiness is awaited after scrolling. Human real-vault acceptance remains pending.

## Formula engine (2026-10-18)

- The shared MathWidget uses MathJax 4.1.3 instead of KaTeX. The web dependency is
  pinned exactly; the lockfile also pins New Computer Modern and the 4.1.3 bbm,
  bboldx, dsfont and mhchem SVG font extensions. Mermaid retains its own KaTeX
  dependency for its diagram syntax.
- mathjaxAssets.ts serves the official startup/core/TeX/SVG components, TeX
  extensions and SVG font data locally in development and emits the same relative
  directory tree into production assets. No CDN is needed for these components.
  The official startup loader selects only the components needed by widgets;
  page-wide scanning, the MathJax context menu and speech workers are not loaded.
- mathjax.ts owns one lazy runtime and calls tex2svgPromise so font/extension
  loading completes before render-pending is cleared. MathJax 4 serializes those
  conversions internally. Widget destruction aborts late DOM updates; completion
  asks CodeMirror to measure the changed layout. Pending/failed widget presentation
  now follows the Formula transition presentation contract above, not raw TeX.
- ui/safe filters attributes from user-authored TeX, including unsafe URL protocols.
  The source session remains authoritative and unchanged by formula conversion.
  The existing dollar-delimiter parser and formula source controls remain shared
  across editing, reading, embedded notes, Canvas, printing and public shares.
- SVG paths use a per-formula local cache. Print receives the SVG stylesheet in
  its own document and can clone formulas without references to the parent page.
- List indentation is remeasured on CodeMirror geometry changes, since asynchronous
  formula layout can rebuild line DOM and discard previously measured styles.
  Pixel comparisons await the visible widgets and list measurements after scrolling.
- Browser regressions cover exact runtime version, inline/display/AMS/chemistry,
  dynamic font and extension loads from the same origin, source entry/close,
  malformed input, URL filtering and disposal while initialization is delayed.
  Integration/packaged checks include Canvas, whole-document print and public
  shares. Real-vault visual acceptance and the OS print dialog remain manual.

Acceptance: isolated source snapshot (base 0942246 + formula-engine changes),
typecheck, 28 unit/HTTP tests, 36 Edge render/integration tests, production build
and packaged Markdown/Canvas share acceptance passed. The snapshot uses its own
Vite cache, core workspace link, browser-test port and output so concurrent theme
and plugin work does not affect this result. No running app was replaced.

References: [MathJax components](https://docs.mathjax.org/en/latest/web/components/index.html),
[promise conversion and local SVG caches](https://docs.mathjax.org/en/latest/web/convert.html),
[safe extension](https://docs.mathjax.org/en/latest/options/safe.html).

## Editor corrections after user acceptance (2026-10-19)

The user reported an invisible dark-mode caret, slow formulas, callout clicks
landing on the following heading, obscured selections, missing callout source
entry, and table controls aligned with the editor column instead of the table.
Earlier browser/build results did not cover this real-note workflow.

- **Callout text ownership:** an unfolded callout is never a whole-block widget.
  Its body remains the original CodeMirror lines and text nodes. Only quote/header
  markers, the title icon/controls and surrounding frames are decorated. Folding
  may hide the body; it must not introduce a second editable text copy.
- CodeMirror 6.43 wrapper measurement includes padding but omits vertical margins
  between children. Outer callout spacing uses a padding-only wrapper; the body
  owns the 8px title gap. Title and body text stay in their original source ranges.
  The title rule remains exactly as tall as its own title container. Live and
  reading titles reserve the same control space so line wrapping stays identical.
- The redundant `mousedown` selection dispatch was removed. It changed revealed
  markup/layout before CodeMirror's own mouse handler calculated the drag anchor.
  Native primary selection/caret now track actual text boxes, including wrapped
  callout lines. Secondary selections use text marks and secondary cursors use a
  measured overlay. Both cursor styles follow document theme colors.
- Callout editing reveals only the title prefix or body quote markers at the
  caret; the former whole-callout `</>` entry has been removed. Original CM text
  and wrappers stay in place. Only `-` defaults to folded; `+` and an absent
  marker default to expanded and all three have a fold control. See callout-lists.md.
  All source entries use the same temporary lifecycle. Inline HTML responds to
  source restoration even if the selection did not change.
- Tables retain the full-column outer layout contract, but an intrinsic-width
  inner frame owns the table and all its controls. Vertical spacing is padding,
  included in the block widget's measured height. Table models are derived once
  per document version, not by reparsing the whole Markdown on every caret move.
- MathJax uses a 256-entry LRU of detached SVG results keyed by TeX, display mode,
  metrics and preamble revision. Equal pending requests share conversion; aborted
  subscribers cannot update DOM, and jobs with no active subscribers skip conversion.
  The queue yields between batches at an 8ms budget, avoiding a clamped timer for
  every simple formula. Each mounted SVG clone gets unique local IDs.
  Definition-bearing TeX bypasses caching; public SVG conversions used by preamble
  plugins invalidate it. Asset loader paths are absolute local web URLs; failed
  loads share a short cooldown and widget error titles retain the actual reason.

Verification for these corrections is **static only**, per the user's instruction:
type checks, production build, and package-content inspection. No browser,
Computer Use, Electron launch, live-note edit, or performance benchmark is part
of this pass. User acceptance must cover dark-mode typing, clicking the second
wrapped body line, drag/Shift selection within/across callouts, nested/folded
source entry and return, narrow/wide table control alignment, and repeated
open/edit/scroll of a formula-heavy note with the user's enabled plugins.

## Table interaction revision (2026-10-22)

### Whole-line source layout follow-up (2026-10-24)

Tables formerly replaced their complete source lines, including native quote and
list prefixes, while inline images/native text retained those prefixes. Fixing
only the table's own CSS would leave math/Mermaid/HTML with separate behavior.
blockLayout.sourceBlockReplacement is now the single entry for those four
whole-line renderers. It retains exact sourceLinePrefix text in an intrinsic flex
column and delegates lifecycle/events/equality to the original widget. TableRow
prefix extraction consumes the same core function. No added observer/cache/parser,
coordinate correction or per-type pixel offset. Native source/session ranges and
the existing TableWidget cell edit/changeTable/sourceControls remain authoritative.
Quoted HTML bodies strip only their structural quote markers before sanitizing;
HTMLBlock extent still belongs to the Markdown grammar, not an HTML-closing regex.

Callout owns a source-width right column and intrinsic frame growth for all
children; see callout-lists.md. The render project now includes elements.spec.ts
and quote-origin.spec.ts, so their checks run with the existing render/theme/prefix
suites. tests/reports/elements-20261024.md records50/50 browser results, actual
geometry, source-preserving cell/row/drag/undo, and the native acceptance limit.

Table source entry uses the shared temporary source region: leaving its selection
or the editor restores the widget without a separate close switch. Cell drafts
still commit through the existing fragment editor. Cell
editor backgrounds are transparent so header cells have one continuous surface.

Editable regular tables expose hover row/column grips. Pointer press highlights
the complete row/column; movement marks a destination without touching source.
Release calls the existing `changeTable(moveRow/moveColumn)` once, dispatching
its local token patches together. Escape, pointer cancellation, scroll, an outside
drop and widget destruction cancel the gesture. Focused grips also accept the
corresponding arrow keys. Readonly/irregular tables have no grips. An active cell
draft must leave editing before reordering, preventing stale-table edits.

The table changes were inspected as source only after the user revoked testing
and acceptance. No post-change type/build/browser/UI/performance result is
claimed; nested Callout geometry, actual pointer input and undo remain unverified.

## Properties and title measurement (2026-10-22)

The reported click mismatch has an exact source match in the disposable Vault:
the note about SCF convergence has YAML on lines 1-9, `iaa` on line 10 and the
SCF paragraph on line 11. The screenshot shows ordinary text, not a Callout or
list; neither a special mouse handler nor a synthetic cursor correction belongs
in this path.

FrontmatterWidget previously returned `.properties.cm-properties` directly as
a block replacement. Its vertical margins (the stylesheet's 24px bottom margin
and the existing base-theme override) sit outside the element rectangle. CM 6.43
measures direct block siblings by their rectangle heights and uses the resulting
height map to choose a line in posAtCoords before scanning inline text. Those
unmeasured gaps can therefore select the following line even when the pointer
visually overlaps the preceding one. The inline title also had an external 0.5em
bottom margin. This source chain explains the symptom; no runtime reproduction
or measurement was performed under the user's no-acceptance instruction.

FrontmatterWidget now returns a flow-root shell around the existing properties
element. The shell contains the properties margins, so their spacing participates
in CM's measured height without moving the divider into the gap or duplicating
property/editor state. Both normal and unsupported-YAML paths return that shell;
source mode and notes without frontmatter create none. A hidden properties child
contributes no margins. The title's 0.5em gap is padding within its own rectangle.
Native primary selection, pointer handling, source ranges and line heights stay
owned by CodeMirror; there is no second cursor dispatch or fixed-height offset.

Only source and Git diff review were performed. Actual click placement, folded
or hidden properties, title combinations, wrapping, IME and browser/native UI
behavior remain unverified. No new tests, type/build checks, probes or application
launches were performed for this change.

### Filename outside source containers (2026-10-23)

A note opening with `>` exposed a distinct ownership bug: inlineTitleField placed
a zero-length block widget at source position 0. CM 6.43.0 BlockWrapper wraps
all blocks beginning at `from`, including a negative-side block widget, so the
first quote (or Callout/code wrapper) included the filename itself.

The existing noteTitleField/setNoteTitle and H1 duplicate suppression now feed
one inlineTitle ViewPlugin. It owns a filename row directly in scrollDOM, outside
contentDOM and all source wrappers. The row scrolls with the note and uses the
same stylesheet column width, margins and font family as content. Flex wrapping
puts the row before the existing native gutter/content row; only a visible title
owns the top page padding. No source position, document text or cursor transaction
belongs to the title. Mode/showTitle/rename/H1 edits update that one presentation;
destroy removes it. The position-0 widget/decoration field is deleted.

Source/diff review only; no tests, types, build, runtime or new package. The
reported temporary raw `> [!tip]` title after Enter recovered on the user's side;
its transient cause has not been established and no speculative Enter fix landed.

## Property type icons (2026-10-23)

Frontmatter rows, the property-type submenu and the add-property suggestions use
the same property type/icon mapping: automatic inference, checkbox, date, date &
time, list, number and text. All glyphs come from `lib/icons.ts`; the existing DOM
getIcon/setIcon/addIcon implementation and its one custom-icon registry live
there too. `obsidian/ui.ts` retains its public exports by re-exporting that same
implementation, keeping the core editor independent of the plugin UI module.
Menus use the existing icon column and checked state instead of Unicode check
prefixes; property add/remove/list controls use catalog plus/x icons.

Automatic removes the key's override through the existing setPropertyType service
and uses the existing registry fallback to infer from the YAML source. No `auto`
pseudo-type is persisted to Obsidian's types.json, and no source list/scalar value
is converted. An explicit type save failure is
reported before changing local controls. The S2 flow-root measurement shell,
divider, source patches, selection and document session remain unchanged.

Only source and Git diff inspection were performed. No tests, typechecks,
builds, probes, app/server/browser launches or UI/performance acceptance were
performed; the change is unverified and has not entered a new package.

## One temporary source entry for every renderer (2026-10-23)

The 0.1.10 property screenshot exposed a failed split in the earlier source
control design: formula/table entries opted into restoration, while properties,
HTML, Mermaid and processor/effect entries still used a persistent branch with a
close widget. Calling one button factory did not give those callers one behavior.

That branch is removed from sourceControls. Every entry now stores only source
coordinates, maps them through changes, and restores presentation after selection
leaves its range, focus leaves the editor, or Escape. Nonempty selections retain
source while they overlap; empty carets include both boundaries. The existing
compositionSelection freezes reveal during IME, and forcedRenderedRegion handles
Escape/blur when no outside caret position exists. No per-renderer source kind,
close widget/decoration/style, replacement close button or additional state exists.
The remaining `</>` sourceButton may request a selected body span for formulas;
all other consumers use the same default entry.

This covers editable and unsupported properties/tables, formula widgets, raw
HTML, Mermaid, code processors (including native JS), and block-effect output.
Unknown/unsupported structures still show real source where rendering cannot
represent them. Returning to rendered script/effect output follows the existing
disposal/remount rules; it does not copy document state or add another renderer.
Mermaid/raw-HTML widget equality includes the source range so prefix edits cannot
leave their source button pointing at old coordinates. Plugin/native processor
caret checks use the same frozen IME selection as source controls.

Fenced HTML keeps its separate explicit execution request and existing sandbox.
Once execution is requested, the rendered frame has only the shared source entry;
the old Hide HTML action is removed. Source editing temporarily suspends the
frame, and leaving source restores it through the shared lifecycle. The initial
Render HTML action remains an execution opt-in, not a source-lifecycle toggle.

Only production source, caller/dead-code searches and Git diff inspection were
performed. No new tests were added; existing browser cases that click the removed
control were deliberately left unchanged under the user's test-maintenance stop.
Tests, types, builds, probes, app/server/browser launches and acceptance did not
run. Actual focus/selection/IME/script remount/UI behavior remains unverified;
the already built 0.1.10 executable predates this correction.

## DOM-owned widget resources (2026-10-23)

CodeMirror may keep a widget DOM node while assigning it to a new equal WidgetType
instance during a block-wrapper rebuild (for example, a same-length Callout type
change). Its later destroy call reaches that new instance. Per-instance WeakMaps
therefore cannot own mounted controllers, subscriptions, fragments or listeners.
MathWidget, NoteEmbedWidget, TableWidget and HtmlPreviewWidget now keep their
existing resource records in module-level WeakMaps keyed by the mounted root DOM.
Destroy removes the record before aborting/disposal, making repeated destruction
inert. The HTML mount also cancels its pending animation frame using its owning
window. No generic host, extra state field or renderer is introduced.

Evidence is source inspection of CM DOM transfer and the resource callers only.
No tests/types/build/probes/app/server/browser or runtime acceptance were run.

## Inline formula hit geometry (2026-10-23)

The B2 click screenshot has a source match in the disposable note
`02笔记/数学/抽象代数/抽象代数 02有限群表示论.md`: line 332 contains the
single-dollar trace formula, line 333 the A1/A2 and B1/B2 paragraph. These are
inline MathWidgets, rather than the properties block from the older iaa/SCF
report. The screenshot does not establish their runtime coordinates or prove
that either report has the same cause.

CM's `basicMouseSelection` calls `posAtCoords`, which first picks a source line
from its measured height map, then `InlineCoordsScan` scans that line's tile
rectangles. For an inline widget this uses the widget root's `getClientRects`;
it does not derive a TeX position from the inner SVG. MathWidget has no mouse
selection dispatch, and DocumentSession already normalizes the note's line
endings, so this change adds neither a pointer handler nor a source offset map.

There is a concrete host-contract gap: MathJax 4.1.3 enables inline line breaking
and can emit multiple SVG siblings and `mjx-break[newline]::before` newlines.
The previous MathWidget root was an ordinary inline span with the default
`WidgetType.lineBreaks = 0`. CM requires ordinary inline widgets to report added
line breaks; a span's fragment rectangles also need not enclose the inner SVG
like one atomic box. The inline root now uses `inline-block`, with the existing
column-width limit and the shared source-line indentation boundary, so internal
SVG layout stays
inside the single box measured and scanned by CM. It retains the normal baseline
and automatic line height. Display widgets keep their existing block shell.
There is no guessed break count, fixed height, mouse adjustment or new state.
Only MathWidget creates `.cm-math-rendered.math-inline`; the plugin adapter's
separate `.math.math-inline` output and the tooltip are outside this selector.
Readonly/embedded/print views that deliberately mount the same MarkdownView use
the same corrected host contract, without a global SVG or reading-output reset.

The 2026-10-24 quote/link correction removes the former MathWidget-local
`text-indent: 0`. `lists.css` now stops native line indentation at every direct
element child, covering math, links, images, nested marks and controls through
one rule. Per-widget resets formerly hid this missing ownership boundary until
an unprotected inline-block link inherited the same negative Q/L indent. See
callout-lists.md, One source-line indentation boundary, for ownership/deletions
and tests/reports/quote-inline-layout-20261024.md for actual reproduction/results.

Math regions/source visibility, the shared selection lifecycle, source ranges,
MathJax queue/cache, width invalidation and completion measurement remain the
existing owners. There is no selection-only observer/measurement pass or second
coordinate system. This replaces the unbounded inline root behavior for every
inline formula rather than adding a screenshot-specific rule. The Callout
Backspace investigation belongs to its separate owner; no common cause has been
confirmed from the source reads.

Only the screenshot, source/callers and Git differences were inspected. No
tests/types/build/probes/app/server/browser/EXE/UI/IME/performance acceptance or
new cases ran. The contract gap is source-supported; actual before/after click
placement, long-formula wrapping and the screenshot's runtime root cause remain
unverified. No note, profile, server/public or release artifact was changed.

## Empty property values and list patches (2026-10-23)

Property rows retain the existing YAML parser and source-token patch ownership.
A missing key has no row. A mapping value that is absent or resolves to YAML null
(`aliases:`, `aliases: null`, `aliases: ~`) has zero values; an empty sequence
also has zero values but retains `list: true`. A quoted empty scalar is one actual
empty string, and a sequence containing empty strings/null items still contains
real source items. Those items remain visible/removable. No aliases-specific
filter or CSS hiding is involved; tags, cssclasses and registry-selected lists
use the same rows. The scalar UI preserves a zero-value source row when its blank
control is untouched, so edits elsewhere do not convert null into `""`.

Previously, an entire null mapping value was projected as `['']`; coercing that
property to a list in the UI generated a phantom empty chip. YAML's empty scalar
can have a zero-length range directly after the colon. Replacing that range with
`[]` without separation could produce `aliases:[]`, which is not the intended
mapping entry and can conflict with later mapping keys. Scalar range writes now
insert the required separation if the preceding source byte is `:`. The read-only
test copy of the reported biochemistry note already contains `aliases:[]`; this
supports the malformed spelling but does not establish the screenshot's prior
source or reproduce its deletion event.

Deleting every item uses the existing sequence CST. A flow sequence loses only
value tokens and commas (including a trailing comma), keeping brackets, comments
and whitespace. A block sequence replaces its first marker/value with `[]` and
removes only the remaining marker/value tokens, preserving comments and newlines.
An indentless sequence needs one leading space when replaced with a flow value;
the old whole-sequence replacement could put `[]` at the top mapping indentation
and discarded intervening comments. It is removed. Subsequent keys, frontmatter
delimiters and Markdown body are outside these patches. Writes still dispatch one
`input.properties` source transaction into the existing DocumentSession/history.

No notes were changed and no malformed existing source is silently repaired.
Only source/CST implementation and Git differences were inspected; no tests,
typechecks, builds, fixtures, probes, app/server/browser launches or acceptance
were run or added. Actual chip interaction and YAML round-trip behavior remain
unverified. Date controls and other settings are outside this change.
