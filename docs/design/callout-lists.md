# Callout and list editing

## Source and ownership

The 2026-10-22 opinion changes use the existing Markdown model, DocumentSession
source patches, CodeMirror selection and native folding. No duplicate Markdown
parser, editable Callout body, note history or persistent fold store is added.
These changes have received source/diff inspection only. The user explicitly
prohibited tests, type/build checks and runtime acceptance for this batch.

## Callouts

`[!type]-` starts folded. `[!type]+` and `[!type]` start expanded. Every Callout
has a fold button, including those without a sign. The user toggle is a view-local
override of the source default; clicking it never inserts or changes `+`/`-`.

The title caret does not force a folded body open. Closing with a caret/selection
inside the body moves the view selection to the end of the title in the same
transaction. Fold controls are native buttons with an expanded state and work in
readonly views without editing the document. Click handling yields during IME.

The whole-Callout source button has been removed. Its title and body remain native
CodeMirror text. Only a touched title prefix or quote prefix reveals source; the
rest keeps its normal decoration. Source mode remains available for arbitrary
Markdown edits. Existing padding-only wrappers retain CodeMirror measurement and
mouse coordinate ownership, including tables/formulas inside the Callout.

`calloutFoldState` keeps its identity for unrelated transactions. Fold decorations
depend on document/source/mode/block-effect changes and actual fold toggles,
instead of rebuilding when the caret moves around ordinary text.

## Lists

Enter continues Markdown markup through the existing
`insertNewlineContinueMarkup`. Tab and Shift-Tab inspect the existing model's
ListItem ancestors. They change indentation at the list's quote depth, moving
descendants together when their parent item is selected. Original markers,
checkboxes, numbering and quote tokens remain untouched. Selection maps with
forward association so a caret at the indentation boundary follows inserted
indentation. Code/inline-code/frontmatter and non-list contexts fall through to
the existing keymaps. No per-keystroke full-note list scan is introduced.

Key ordering is: active suggester, native snippet/tabstop/math tabout, contextual
list indentation, generic Tab. `markdownListKeymap` is installed by MarkdownView
before `indentWithTab`; native `snippetStateField` is installed at high precedence.

`listFolding` resolves multiline ListItem ranges from the immutable syntax tree
at visible line ends and supplies them to CodeMirror's foldService. Its controls
call native foldEffect/unfoldEffect and use native foldedRanges. Parent and child
folds share the same per-view state as keyboard folding. There is no second fold
set. Hidden-body selections move to the parent line when closing. Readonly views
may fold without changing source; source mode keeps the normal code-fold commands
without the live list buttons. Explicit source/block-effect ownership hides list
controls until the shared invalidation contract releases the region.

Bullets are small CSS circles independent of font glyph shape. Indentation guides
use the same configured unit as Tab and align with bullet centers. Chevron paths
come from the existing icon catalog.

## List layout invalidation

`listLayout` measures on document, viewport and geometry changes. A scoped
MutationObserver schedules a measure only when actual list lines/markers change;
selection-only and arbitrary effect transactions no longer schedule measurements
unconditionally. Observer attributes exclude the inline styles written by the
measurement itself. CodeMirror requestMeasure coalesces scheduled work.

Geometry changes remain an invalidation because asynchronous MathJax/font layout
may rebuild lines and discard inline measurements. Queries exclude nested editor
content, whose coordinates belong to its own editor. No measured speedup is
claimed. UI, keyboard, readonly, IME, selection, nested folding and performance
remain unverified under the user's no-acceptance instruction.
