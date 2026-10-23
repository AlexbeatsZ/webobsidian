# Quote prefixes and heading gutters (2026-10-23)

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
  geometry together, using native source positions. Transparency preserves prefix
  width in both reveal states; wrapper padding and native text/caret remain owned
  by CodeMirror. No source rewrite, second observer or selection compensation.
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

Only archive/source/dependency reads, screenshot inspection and Git diff checks.
No tests, typechecks, builds, probes, app/server/browser launches, interaction,
IME/performance acceptance or new tests. Actual click/caret, multi-line quote,
heading wrap and keyboard behavior remain unverified until user acceptance.
