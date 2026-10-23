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
The title fold button inherits the title's font and line-height, so its `1lh`
button box centers the SVG on the text line instead of using native button font
metrics. The SVG is a block inside the centered flex button. This does not change
CodeMirror's text lines or mouse dispatch.

The whole-Callout source button has been removed. Its title and body remain native
CodeMirror text. Only a touched title prefix or quote prefix reveals source; the
rest keeps its normal decoration. Source mode remains available for arbitrary
Markdown edits. Existing padding-only wrappers retain CodeMirror measurement and
mouse coordinate ownership, including tables/formulas inside the Callout.

Quote prefixes remain native text with the same width when hidden and revealed;
only their color changes through `cm-quote-prefix`. The previous marker-only
`left: -1ch` offset and hidden-prefix replacement were removed after user feedback.
The existing listLayout measures separate native inline-block boxes: quote
prefix Q and list indent/marker prefix L. It reads their actual widths, never
source-boundary caret coordinates or an already indented line's padding. CSS
owns `text-indent: -(Q + L)` and `padding-left: base + L`; ordinary lines have
base zero, while body-local headings declare their existing 24px base in their
own stylesheet rule. A plain quote has L = 0, so body text and wraps stay at the
wrapper's original content edge while its prefix occupies the existing gutter.
Quoted lists retain their actual source whitespace/marker width. Native
.md-quote wrappers continue to own continuous/nested rules, including
lazy continuation lines; no second rule renderer, observer or fold state exists.
Callout title replacement remains its existing icon/title control path; body
prefixes use the same native-text layout. A Callout title is excluded from list
prefix measurement even when it is nested in a parent ListItem, so its own icon
padding stays authoritative. Full source mode retains literal text.
See reference-editor-layout.md for the local Obsidian package evidence and limits.

`calloutFoldState` keeps its identity for unrelated transactions. Fold decorations
depend on document/source/mode/block-effect changes and actual fold toggles,
instead of rebuilding when the caret moves around ordinary text.
After document or selection changes, an empty caret in a Callout body expands
that Callout through the same override state. This includes deleting a separator
and merging two blockquotes: merging is valid, but the caret inside the merged
body must not stay hidden. Only the caret's Blockquote ancestors are looked up
in the source-ordered existing containers by binary search; no full-note scan,
extra parser or separate fold state. The title caret still does not expand a
fold; explicit close moves a body selection to the title in the same transaction.
Nonempty selections, normal text patches, deletion and DocumentSession undo
remain unchanged. Remote/content changes use the same mapped local caret rule,
not a special Backspace or multiple-change heuristic. Reading mode is excluded.

## Lists

Enter continues marker lines through the existing `insertNewlineContinueMarkup`.
For an unmarked, nonempty paragraph line inside a ListItem, Enter preserves that
line's exact quote and whitespace prefix. This avoids resetting an extra Tab to
the parent's marker width or inserting a new bullet. Empty lines and other block
types retain native Markdown continuation and list-exit behavior.

MarkdownView explicitly installs four-space `indentUnit` and four-column
`EditorState.tabSize` for every Markdown host, including readonly fragments and
source mode. The old implicit two-space indent unit with four-column literal
tabs was inconsistent. No existing note is reindented on load.

Tab and Shift-Tab inspect the existing model's ListItem ancestors through
`markdownListLine` in listLayout; folding and visible line presentation consume
the same source owner instead of maintaining their own ancestor search.
They change indentation at the list's quote depth, moving
descendants together when their parent item is selected.
The descendant extent comes from the same cached `markdownListFold` boundary
used by folding, rather than grammar-lazy `ListItem.to`. Thus Tab/Shift-Tab on a
header cannot move unindented following prose; explicitly selected prose still
uses ordinary indentation.
`fmtIndent`/`fmtOutdent` call the same exported `indentMarkdown` as Tab/Shift-Tab,
so command-palette and hotkey invocation retain child ownership and quote
prefixes. Non-Markdown contexts rejected by this function keep the existing
native indentMore/indentLess fallback; composition does not invoke either path.
Original markers,
checkboxes, numbering and quote tokens remain untouched. Selection maps with
forward association so a caret at the indentation boundary follows inserted
indentation. Ordinary paragraph and quote continuation lines also accept Tab and
Shift-Tab without acquiring a bullet. Dedent uses CodeMirror's column counting
and indentString, so mixed spaces/tabs remove one configured unit. Code,
inline-code and frontmatter keep their existing keymaps. Syntax lookup is local
to the line/selection; no per-keystroke full-note list scan is introduced.

Key ordering is: active suggester, native snippet/tabstop/math tabout, contextual
list indentation, generic Tab. `markdownListKeymap` is installed by MarkdownView
before `indentWithTab`; native `snippetStateField` is installed at high precedence.

`listFolding` resolves ListItem ownership from the immutable syntax tree, then
`markdownListFold` in the existing listLayout limits its fold extent to explicit
source indentation. A nonblank continuation must reach the item's content column
after its quote prefix. The first unindented/dedented paragraph ends the fold,
even if Markdown's lazy-continuation grammar still includes it in the ListItem.
Real indented paragraphs and child items remain eligible; whitespace before the
next outside paragraph remains visible. Source is never rewritten. Bounds are
cached by immutable model, header position and tab size, rather than rescanned on
each selection update.

The narrowed range is supplied to CodeMirror's foldService. Its controls
call native foldEffect/unfoldEffect and use native foldedRanges. Parent and child
folds share the same per-view state as keyboard folding. There is no second fold
set. A transaction extender normalizes native fold requests and mapped existing
folds after document changes, because returning null from foldService still lets
CodeMirror fall back to the grammar's full ListItem range. The extender appends
native unfold/fold effects within the same transaction; it never dispatches a
second transaction or introduces custom folded state. Smaller native/plugin folds
remain smaller. With no active fold or fold request,
the extender does not instantiate a new state on document edits. When a changed
document needs correction, it reuses the existing `adoptSyntaxModel` effect so
the final transaction retains the already analyzed immutable model.
Hidden-body selections
move to the parent line when closing. Readonly views
may fold without changing source; source mode keeps the normal code-fold commands
without the live list buttons. Explicit source/block-effect ownership hides list
controls until the shared invalidation contract releases the region.

Bullets are small CSS circles independent of font glyph shape. Indentation guides
use the same configured unit and literal-tab columns as Tab and align with bullet
centers. Marker-free ListItem lines receive the same guide and hanging-layout
measurement as headers, using their actual source whitespace. Marker-shaped text
without a ListItem syntax owner stays literal. Chevron paths come from the existing
icon catalog.

The list fold button has a zero-width inline anchor whose inherited `1lh` height
tracks the first line. Folded line decoration drives both chevron and bullet
through the existing `--interactive-accent`. Native `.cm-foldPlaceholder` gets
transparent/rest and theme-token hover/foreground styles instead of CodeMirror's
hardcoded light background and border.

List whitespace must not inherit the parent line's negative hanging
`text-indent` inside `.cm-indent` inline blocks. The list-scoped indent span resets
`text-indent: 0` and uses `white-space: pre`; its actual spaces/tabs retain their
source width. Bullet and ordered-marker spacing is no longer collapsed to a
single space. These changes preserve the four-column source step in rendered
headers and marker-free continuations without inventing a CSS-only indent level
or changing the existing hanging-layout measurement formula.

## List layout invalidation

`listLayout` uses its one requestMeasure and one scoped MutationObserver. Native
prefix boxes use `white-space: pre; text-indent: 0`, so changing the line's
indent cannot change their measured width. Measurements are rounded to CSS
subpixels and changed values enter the existing `prefixWidths` StateField through
an effect. Its line decorations own the two CSS width properties; CodeMirror
applies the resulting style attribute. There are no external inline-style writes,
style-restoration observer, cached computed base padding or reset/re-measure pass.
The measure write queues the effect in a microtask, guarded by document identity
and plugin lifetime. Prefix/line insertions, removals, source-position attribute
changes or prefix text changes invalidate; quote reveal color and formula/body
mutations do not.

The existing `data-prefix-layout` line attribute carries the absolute source line
start for both quote and list producers. Measurement reads that position directly
instead of recovering it with `posAtDOM` for every line. On document edits, cached
keys use `MapMode.TrackAfter` and survive only if the following source character
survives and the mapped position is still exactly a line start. Deleted prefixes
or merged-away line starts must not transfer their widths to a neighboring line;
the normal measurement supplies new widths after the edit.

Inline concealment follows the same syntax ownership boundary: Emphasis and
StrongEmphasis hide only `EmphasisMark`, InlineCode only `CodeMark`, and
Strikethrough only `StrikethroughMark`. Lezer can inject structural `QuoteMark`
and `ListMark` children into multiline inline nodes. Those children remain owned
by the quote/list prefix path, so entering or leaving emphasis cannot remove the
prefix box. The existing math-delimiter ownership guard remains in force.

The line-level exclusion must also distinguish block code from inline code.
Lezer's multiline InlineCode source range can cover an entire continuation line,
including a structural QuoteMark injected inside that node. Block code, HTML and
math still skip the whole line before structural layout. Inline code remains in
the existing literal ranges, but its quote/list prefix and continuation indentation
first go through the same native prefix path as ordinary text. The body passes
then skip a fully covered literal line; inline HTML rendering also honors the
existing literal-range guard. This preserves literal body text without exposing
the structural marker or introducing a second parser/layout path.

Document, viewport and geometry changes remain invalidations for font/layout
changes. Queries exclude nested editor content. Native Callout spacing/frame
width is fixed to the existing column, allowing formula metrics to depend on
that column instead of intrinsic formula width feeding back into the frame.
Original vertical measured padding and native caret text stay in place. No measured speedup is
claimed. Earlier changes were source-only. The user's temporary testing
authorization now permits focused regression and isolated native acceptance;
results and remaining gaps belong to the current test/acceptance reports.

## Callout 第一行公式源码入口（2026-10-23）

显示公式的 `</>` 从公式自身移到所属 Callout 的标题行，避免一个 Callout 内多个公式
各自占用正文位置。归属在现有不可变分析里算一次：`blockModel` 用 `containers` 的
`bodyFrom..to` 找出包含该公式的最深 Callout，得到 `mathCallout`（公式起点 → 标题起点）
与 `calloutMath`（标题起点 → 公式列表）。选择变化只读取这两张缓存表，不重新解析。

归属派生复用容器的语法树前序与按源码排序且互不重叠的 dollar 公式：游标只推进一次，
临时栈保留当前 Callout 祖先链，标题行不入本 Callout 正文；公式跨过内层结尾时回退到
仍完整包含它的外层。每个容器至多入栈/出栈一次，替代每个公式遍历全部 Callout 的乘积
扫描；输出仍是以上两张缓存表，不添加索引或解析器。仅源码复杂度分析，未测量运行耗时。

标题行的控件是一个独立 widget：按 `calloutMath` 生成与公式数相同的 `sourceButton`，
沿用同一 `sourceRegion` 和选区/失焦/Escape 自动恢复，点击后选中该公式正文。因此
Callout 内公式不再渲染自己的源码按钮（`MathWidget.sourceInTitle`）；正文 `</>`（HTML、
Mermaid、表格、属性、代码块、块效果）保持原位。只读、整篇折叠、正被源码显示或由块效果
接管的公式不生成控件；折叠状态改变会随现有装饰重建一起更新。

标题行的 `--callout-formula-controls` 只为文本预留控件宽度（上限 50%），按钮组绝对定位在
标题右上、`height: 1lh` 内垂直居中，超出时自身横向滚动。折叠箭头继续使用既有
`1lh` 内联锚点与 accent 令牌，与第一行居中；没有新增第二套按钮状态、解析器或折叠状态。
