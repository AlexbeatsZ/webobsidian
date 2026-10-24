# Quote prefixes and heading gutters (2026-10-23)

## Current source-width contract

The later user correction explicitly requires only the native `>` / source-space
advance, transparent when concealed, with styling added without widening it.
This supersedes the earlier 24px wrapper-gutter formula recorded below. Current
listLayout still measures intrinsic Q/L boxes; line padding is base + Q + L and
text-indent is -(Q + L). Quote wrappers add no horizontal padding/border width;
their continuous rule is absolute, with nested origins supplied by intrinsic
transparent prefix text. The latest user clarification distinguishes white
ordinary quote rules (before their own `>`, strut ends before that marker) from
colored Callout title rules (after their own `>`, strut includes it but excludes
the final separator). Ordinary 3px borders end at the marker's left edge;
the source text never moves. The prior shared right-edge claim was incorrect.
Removed unused cm-blockquote line borders and
depth-gradient rules; native md-quote is the only quote-rule owner. Math source
continuations retain the same structural-prefix pass before literal-body exclusion.
The filename now lives outside contentDOM, so a first-source quote cannot wrap it.
Callout headers also preserve all quote prefixes: only the core model's exact
markerFrom..markerTo token becomes the inline icon/default title, with original
separator whitespace left intact. Removed fixed title/icon offsets; title type
color is scoped to its own title wrapper, and nested body text remains neutral.
The native wrapper no longer also carries the generic callout-title class. The
copied Vault Theme.css applies padding-left12px/flex/a left rule to that class;
this independent source rule survived removal of native icon offsets. Native
md-callout-title now owns layout without a competing legacy class or CSS override.
Actual enabled/computed styles in the user's window have not been inspected.
The subsequent screenshot exposed retained frame padding: Callout frames now have
zero horizontal padding and use an inset painted border instead of an in-flow
border, so no ancestor frame adds a 16px/0.5px source-origin shift. This correction
does not move individual `>` glyphs. Thematic breaks now use the existing grammar's
HorizontalRule node rather than a full-raw-line regex, retaining quoted prefixes.
The2026-10-24 focused real-editor Edge tests now check the distinct rule sides,
source origins, nesting/reveal, Tip Enter and table/quoted HR; see
tests/reports/quote-origin-20261024.md. The actual user's native window/IME and
historical Tip transient cause remain unverified.

## Evidence and ownership

Reference archive read only: `C:/Users/Meta/AppData/Roaming/obsidian/obsidian-1.14.5.asar`.
Its package.json reports Obsidian 1.14.5. app.js and app.css were extracted temporarily
with the repository's existing @electron/asar reader; no application or plugin was
executed. The older docs/obsidian-desktop-internals.md describes macOS 1.12.7 and is
background rather than evidence for this installed version.

In 1.14.5 app.js, the formatting-quote branch uses a transparent mark (q5) for the
first quote marker and a transparent cm-blockquote-border widget (U5) for nested
markers when the owning line is not active. It preserves marker advance, unlike
our previous empty replacement. hU/dR derive the prefix and dU's existing hanging
layout measures its endpoint before applying negative textIndent and positive
paddingInlineStart. app.css lines 3736-3737 reset child text-indent; lines 11609-11635
color revealed markers, retain transparent inactive ones and draw quote borders
through full-height pseudo-elements. This is source evidence, not a claim that
our DOM must copy Obsidian's tokenizer or that the user's screenshot was reproduced.

app.js MW/TW supplies fold indicators from existing folded ranges/foldable sections.
app.css lines 8277-8291 gives the inline fold anchor a zero-width text strut and
positions its icon against that line, not the full padded heading. H1-H6 typography
and heading padding are separate. No app-native H2 label is implied by this rule:
the user's Theme.css adds its own heading pseudo-label.

## Source-supported failure paths

Our quote path removed the complete inactive prefix, then restored raw source
with only the > glyph shifted left 1ch when active. That cannot preserve the body
advance or hanging wrap relation. .md-quote already owns continuous/nested border
and padding, so a second line rule or isolated numeric glyph offset is unnecessary.

Our heading path added cm-heading-labelled only when inactive. Its ::before used
bottom:0 on the entire padded line and a separate small UI-font line box. The
local test-copy .obsidian/snippets/Theme.css lines 47-105 additionally sets heading
::before via .HyperMD-header-N, left:-3em and margin-top:var(--hN-size), excluding
.cm-active; our path does not produce that active class. These are competing
source rules with different anchors and state predicates. Which enabled CSS won
in the user's actual window remains unverified; screenshots alone cannot establish
computed style. The native label implementation now has a single DOM owner and
suppresses legacy line pseudo-labels only on lines explicitly owned by the
`data-native-heading-gutter` widget in all states. It does not disable arbitrary
heading pseudo-elements on reading HTML, body headings or hosts without this
native gutter. This targeted ownership override is needed when a Vault still
loads the migrated Theme.css label rules; no Vault snippet was rewritten.

## Implementation

- The existing listLayout requestMeasure/observer handles quote and list prefix
  geometry together. After the post-0.1.12 feedback, it measures isolated native
  prefix boxes rather than caret coordinates at source boundaries. Transparency
  preserves prefix width in both reveal states; wrapper padding and native
  text/caret remain owned by CodeMirror. No source rewrite, second observer or
  selection compensation. The superseded computed-base cache and style-reset
  pass are removed rather than retained as another fallback.
- listFolding's existing button widget also hosts standard heading labels/controls.
  For H1-H6 it asks CodeMirror foldable for the section extent; the language's
  headerIndent foldService already implements section termination. Fold effects,
  keyboard commands, collapsed ranges and placeholders share existing native state.
  The button keeps IME/readonly-folding semantics and moves a hidden selection in
  the same transaction. A zero-width 1lh anchor starts at the heading source start;
  label and arrow occupy separate gutter columns. Label position is independent
  of ## reveal, leading paragraph padding, wrapped-title height and active state.
- No fold is synthesized for ####### BodyHeading. Existing explicit list bounds
  and list folding normalization remain unchanged. Heading labels persist through
  source reveal; full source mode gets the same available section control.

## Post-0.1.12 source correction

The old W/Q formula read `coordsAtPos` at mark/replacement boundaries on a line
whose own text-indent/padding had already been changed. It therefore lacked a
source-independent prefix-width invariant, particularly when a block formula
split the line or a mark/selection changed its caret side. The per-DOM WeakMap
also cached computed base padding and saved inline styles; a class change ran a
restore pass and then measured again. CM's LineTile attribute synchronization
can clear outside inline styles, so that cache could no longer establish one
style owner. These are static risks; no event trace proved which caused the
reported jump or which version the user was running.

Now Q (quote prefix) and L (list indent/marker) come only from independent
inline-block/pre boxes, scaled with the existing view.scaleX and rounded to
CSS layout subpixels. The stylesheet owns line padding `base + L` and indent
`-(Q + L)`. Thus first-line body and wrapped lines both begin at base + L;
ordinary quote L=0 adds no second wrapper gap. Reading a prefix width cannot
depend on either written property, the frame width, formula text, caret side or
the source/preview visibility of the following emphasis. This correction initially
still wrote width properties outside CodeMirror and restored missing properties
through its observer. That remaining ownership conflict is superseded by the
StateField correction below; it is not part of the current implementation.

## Post-0.1.13 click-jitter correction

User feedback on 0.1.13 still reported quote titles and Callout body text jumping
left-right on random clicks. Static source tracing identified an ownership conflict: the
width variables were written as external inline styles during the CM measure
phase (outside `observer.ignore`). CM 6.43's own DOMObserver watches all
attribute records without a filter, flushes attribute-only records
synchronously, and `readMutation` marks the line tile attrs-dirty. The next
view update — every click, because selection changes rebuild the decorations —
runs `tile.sync()` → `setAttrs()`, which removes any DOM attribute absent from
CM's own line attributes, including that inline style. Removing these variables
changes `text-indent` until listLayout's observer restores them, and that external
restore can trigger another synchronization. This source path explains a possible
alternation in prefix advance; the user's event sequence and painted frames were
not captured.

Widths now live in the `prefixWidths` StateField and reach the DOM only as a
line-decoration `style` attribute (`--cm-quote-prefix-width` /
`--cm-list-prefix-width`). CodeMirror merges multiple line styles with `;`,
re-applies its own attributes on every sync inside `observer.ignore`, and
compares them by value, so measurement updates flow state → decorations →
CM-owned DOM writes with no external mutations left to wipe. The measurement
itself (isolated prefix boxes, scaleX, 1/64px rounding) and the
doc/viewport/geometry scheduling are unchanged. The observer's style-restore
branch and the destroy inline-style cleanup are removed with the external write
path; its remaining job is structural (`data-prefix-layout` attribute and
prefix/line insertion/removal records). Dispatching from the measure write is
forbidden (update guard), so changed widths dispatch from a microtask guarded
by doc identity and plugin lifetime. First appearance of a prefix line can
still shift once when measurement lands, same as before. The source no longer
contains the external wipe/restore path; actual click stability remains unverified.
Desktop version 0.1.14 was reserved, but packaging stopped during Electron
download and no completed 0.1.14 portable was found during this review.

Native Callout frame/spacing now has a definite column width, preserving its
vertical padding, title/body wrappers and plain-text editing. The earlier
fit-content/min100% native wrapper and 100%-wide formula shell had opposing
intrinsic sizing dependencies. Plugin .callout, HTML and wide table output keep
their separate existing width contracts; MathWidget/MathJax metrics are unchanged.

Actual image inspection also established the heading order requirement: the
current a3e2fb32 screenshot is arrow, H2, long title with an excessive gutter;
the 9a566da8 reference is H2, arrow, title. Only the existing label/button gutter
columns change (label end22px, 14px arrow end4px). The zero-width first-line
anchor, title font/weight, natural wrapping and native fold state stay the same.

Screenshots inspected with view_image (all under C:/Users/Meta/AppData/Local/Temp):
- codex-clipboard-39976d65-362c-46ed-8596-cd10e5f717f3.png (Callout with three formulas)
- codex-clipboard-16966daf-13bc-4d4a-a483-9885e25310b8.png (ordinary quote gap)
- codex-clipboard-a3e2fb32-93e8-458f-8b0b-3868ee8276ef.png (current heading controls)
- codex-clipboard-9a566da8-650b-4800-b7d6-666f64010d7f.png (required heading order)
- codex-clipboard-ed672321-38ee-4bc6-92e7-975bdc295de3.png
- codex-clipboard-484159e3-3e46-458c-89f9-deab62a06c94.png (same maximum-likelihood section states)

The last pair supports the user's instability report, not an exact pixel delta:
crop/scroll/viewport state and actual event trace were not observed. Matching
test-copy notes were read only. Emphasis source markers may legitimately be
visible at an active caret; no blanket concealment rule was added.

## Prefix cache and inline delimiter review

The follow-up preserves the `prefixWidths` StateField, existing measurement pass
and structural observer. Cache keys now map with `MapMode.TrackAfter`, which the
installed CodeMirror state package defines as dropping a position when its next
character is deleted. A mapped key must also remain exactly a source line start.
This prevents deleted lines or merged-away line starts from donating stale widths
to the surviving neighbor. The existing quote/list `data-prefix-layout` attribute
now carries that source start directly, removing per-line `posAtDOM` traversal
from measurement without adding a second source-position index.

The installed Lezer Markdown parser's `injectMarks` can place structural quote/list
markers within multiline inline nodes. Matching every child name ending in `Mark`
therefore lets emphasis conceal quote/list prefixes. Concealment now selects only
the owning syntax's delimiter: `EmphasisMark`, `CodeMark` or `StrikethroughMark`.
The quote/list prefix boxes and math-delimiter guard retain their existing owners.
These are source-supported defects and corrections, not a reproduced UI trace or
a measured performance improvement. No extra parser, fold state, observer or
keyboard/selection pipeline was introduced.

## Multiline inline-code continuation correction

The authorized focused browser run reached editor assertions: five cases passed
and the multiline inline-code case failed because only one quote prefix was
decorated. The failure screenshot exposes `>` on the second line. Reading the
installed Lezer parser for `> - ` followed by a backtick, `QuoteFirst`, newline,
`>   QuoteSecond` and the closing backtick gives an InlineCode node with children
CodeMark, QuoteMark, CodeMark, all within the original ListItem/Paragraph. The
second marker is therefore structural; the fixture's two-prefix expectation is
valid. Its full source line lies inside InlineCode's source extent, so the old
whole-line `codeRanges` skip bypassed both quote and list prefix decorations.

The existing decoration traversal now adds only block code to the pre-structure
whole-line exclusions, retaining HTML/entity/math exclusions there. InlineCode
already belongs to the immutable model's literal ranges, so the redundant code
range registration was removed. A fully covered literal continuation passes
through the existing quote/list/indent path before skipping body processing.
The earlier whole-line inline-HTML branch now checks that same literal guard.
There is no new parser, cached index, observer, prefix renderer or input pipeline.
This correction requires the test owner's rerun; the earlier five passing cases
do not establish that the revised source passes, and portable 0.1.15 predates it.

## Validation boundary

The Callout Backspace report has a distinct source-supported path: the test-copy
finite-group note has two same-depth proof- Callouts separated only by an empty
line (around lines 364-368). Native Markdown Backspace deletes only before pos;
the Callout fold decoration isn't an atomic range. Removing the separator lets
Markdown merge the blockquotes; blockContainers identifies the first Callout and
its recomputed default fold then covers the second header/body. calloutFoldState
now expands a collapsed Callout whenever a document/selection update places an
empty caret in its body. The user explicitly accepts merging and requires this
caret invariant, so the earlier proposed delete-only growth check was removed.
This preserves the original edit/undo and explicit selection deletion, without a keyboard interceptor. No
event-level evidence proves whether that exact merge or a misplaced selection
caused the user's reported operation; source disappearance and source deletion
must remain distinguished. Shared owns the independent formula hit-testing work.

The initial source batches used only archive/source/dependency reads, screenshot
inspection and Git diff checks, with no executable acceptance. The user later
temporarily authorized builds, focused tests and isolated native interaction for
this prefix review. The multiline-code section records the pre-fix regression
result; its post-fix rerun and remaining acceptance gaps belong to the current
test/acceptance reports. No broad IME, performance or all-heading-wrap claim is
implied by the targeted checks.
