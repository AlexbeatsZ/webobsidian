# Native writing tools

## Contract

LaTeX Suite 1.14.0 and Linter 1.31.2 supply the behavior baseline. Snippets,
formula input/presentation and document formatting are native features, sharing
the existing document session, source changes, syntax model and MathJax service.
Do not load the original plugins as well. Preserve their files and Obsidian
enablement. Preserve upstream MIT attribution for adapted source.

Keep the native snippet directory or an explicitly configured source authoritative.
Do not import app/plugin settings on startup. Conceal defaults off;
other retained visual/input features default on. Exclude matrix input shortcuts,
automatic input-method switching and Vim. Matrix template snippets remain valid.
Normal IME composition handling remains necessary. Future Excalidraw formula
editors must consume these same native editing capabilities.

CodeMirror evaluates Facet.define's combine([]) immediately. Default settings now
depend on the pure concealMacros module, not editor extensions or math context;
MathMode belongs to mathbounds. This removes the previous initialization cycle
and its lazy-default workaround. Do not reintroduce runtime editor dependencies
into configuration parsing. Production-entry boot is covered by
tests/packaged-startup.mjs, beyond harness/type checking.

Body-local titles (`####### 标题`) are shared `BodyHeading` syntax, outside
structural H1–H6 formatting. The common heading matcher and AST heading visitors
exclude them; Header Increment must neither rewrite them nor use them to map
the following ordinary headings. General body/whitespace rules and explicit
custom regexes retain their configured scope. See body-headings.md.

The adapted Linter evaluates native rule settings, ordered custom regexes,
ignore paths and timestamp policy. Rules retain pre/regular/custom/post ordering.
Paste formatting is a separate entry point. Snippets and formatting share native
LaTeX Suite replacement semantics; runtime never imports old Linter settings or
converts legacy replacement strings implicitly.

## Replacement language and migration

`packages/markdown-core/src/replacement.ts` is the only template compiler and
evaluator. Snippets request tabstop positions; formatting takes the same output
text without interactive state. Matching remains native JavaScript RegExp with
its flags, lookarounds, named groups and Unicode support. No second regex engine
or reduction of matching capabilities is introduced.

| Template | Meaning |
| --- | --- |
| `[[0]]`, `[[1]]` | First, second capture (LaTeX Suite zero-based numbering) |
| `[[<name>]]` | Named capture; extension to the original template syntax |
| `$0`, `${0:default}` | Interactive snippet tabstop; formatting inserts its default or empty text |
| `${VISUAL}`, `${VISUAL_ORIGINAL}` | Selection content supplied by a visual snippet |
| `${MATCH}`, `${BEFORE}`, `${AFTER}` | Complete match, input before/after the match |
| `${DOLLAR}`, `${LBRACKET}` | Literal `$` or `[` when it would otherwise start a token |

Plain backslashes are literal. A template containing `\frac` inserts `\frac`;
template evaluation never turns `\f` or `\n` into control characters. The source
container still follows its own string grammar: JSON `"\n"` is a real newline,
JSON `"\\frac"` is the literal template `\frac`, as with a JavaScript snippet
string. Plain dollars remain literal except where `$digit` or `${...}` forms a
recognized template token; `${DOLLAR}1` explicitly inserts `$1`.

Captured/selected text is appended as data, so `$1` or `[[0]]` inside it cannot
create new tabstops or captures. Templates compile once with their settings.
Match-prefix/suffix strings are lazy, avoiding full-prefix copies for ordinary
snippet expansion and ordinary regex replacements.

`legacyReplacement.ts` remains for historical test fixtures, outside runtime loading. It reproduces the
old Linter escape-decoding order and JavaScript substitution rules, then emits
native templates: `$1` becomes `[[0]]`, `$&` becomes `${MATCH}`, and `$$` becomes
a literal dollar with an explicit escape only when needed. Named substitutions,
two-digit capture fallback, prefix/suffix substitutions and literal tokens are
preserved. For the configured formula rules, `$1$$$2$$` becomes `[[0]]$[[1]]$`
and `$$$$$1$$$$` becomes `$$[[0]]$$`.

Native configuration uses `linter.replacementSyntax: "latex-suite-v1"` (also the
default for an omitted marker). Runtime reads never reinterpret replacement
strings as legacy syntax. Unknown versions produce an error. Old plugin/app
files remain untouched and are not startup configuration sources.

## Shared ownership

- Markdown core owns source ranges and formula regions. Formula-local TeX
  parsing is cached and reused by editing/presentation; no second Markdown
  parser is installed by the writing tools.
- DocumentSession owns text history, source preservation and saves. Formatting
  commits one change group; snippet state follows history/position mapping.
- Manual save formats once before persistence. Autosave, navigation saves,
  plugin writes and external changes do not trigger whole-document formatting.
- The timestamp rule's opt-in delayed update changes only timestamps, through
  one debouncer per session. Its default setting is `never`; background autosave
  itself still only persists. File-change formatting follows its explicit option.
- Format on a working copy, reject stale results and report errors before
  committing. Honor document conflicts and ignore settings.
- MathJax owns conversion, cancellation and output reuse for all formula hosts.
  Presentation never writes Unicode or preview markers into source.
  Native package selection and preamble configuration now use the same lifecycle;
  see native-math.md for configuration candidates, context state and command metadata.
- Settings, commands and file events use the existing host services. Preserve
  code/HTML/public-share execution boundaries.

## Formula editing presentation (2026-10-22 opinion changes)

`mathPresentation.ts` owns the shared source-visible and edit-preview policy used
by Live Preview, native TeX overlays and previews. Dollar edges are inclusive for
preview; snippet context still uses the formula body boundaries. Readonly views
always render. A caret or selection in a formula reveals its source, and the
shared formula source entry selects the body without its dollar delimiters.
Formula/table entries use the common selection/focus lifecycle to restore output;
they do not create another persistent visibility switch.

Display and multiline formulas preview within the document below their source.
Only inline formulas use a tooltip. Both hosts call `mathPreviewTex` and the same
`renderMath` queue with source-order definition context and transient output.
Selections, IME, delimiter edges, command names, unbraced arguments and opaque
literal/chemistry/unit contexts use normal TeX when a cursor cannot be placed
reliably. Preview markup never changes note source. Bracket highlighting shares
the same safety gate. Unknown or incomplete TeX is still rendered normally by
MathJax instead of inventing a cursor inside a control word.

Multiline dollar formulas belong to the direct block decoration field even when
their opening delimiter shares a line with TeX; they must not become multiline
replacements in a ViewPlugin. The shared blockModel derives those ranges and the
remaining inline groups from the same mathRegions result. Markdown tree/regex
decoration skips formula content so TeX underscores, links or highlight-like text
cannot claim a partial replacement before the formula renderer.

For emphasis/strong/strikethrough, ownership is also checked on the node's own
Markdown delimiter tokens. A node can cross several formulas (for example, the
two `^*` markers in `$\boldsymbol{\alpha}^*$` and a later inline formula), so
checking only whether the whole node lies inside one formula is insufficient.
If any of its delimiters belong to dollar math, skip that node's styling and
concealment while still visiting children. Delimiters outside formulas continue
to support legitimate Markdown emphasis around formulas. This uses the existing
cached math ranges and leaves math parsing, source visibility and MathJax intact.

The inline tooltip is derived directly in its StateField. No extra update effect,
microtask dispatch or second preview state machine is needed. Native safe visuals
are installed once by MarkdownView independently of user snippets/plugin execution.
Private writing settings retain their existing configuration facet/hot reload.
The settings page exposes syntax highlighting, edit previews, display previews,
bracket highlights and the preview cursor through the existing LaTeX settings.
`mathPreviewLivePreviewDisplay` now controls the document preview, with a true
default; an explicitly stored false remains respected.

### Formula measurement and width feedback (2026-10-23)

`WidgetType.toDOM` runs before CodeMirror inserts the widget, so nothing there may
convert a formula or read its metrics. `MathWidget` and the inline tooltip both
start `renderMath` from `view.requestMeasure`, after the host is connected, and
read metrics only from that attached container. `readMathMetrics` is the one
metrics reader used by conversion and CM hosts; the hosts pass its snapshot to
the existing conversion queue/cache, so starting conversion in the write phase
does not read layout again.

That snapshot also carries the effective body font family, read from the same
computed style as its size. Formula text inheritance, conversion/pending cache
keys and existing widget/tooltip metric comparisons consume that one value;
see native-math.md, Text fonts and code fallback. Text/Chinese use the same
document font source, while code retains its own Cascadia Code/Noto Sans SC stack.

Width must not flow back into the editor's own width:

- A display formula keeps `width: 100%`/`min-width: 0`/`max-width: 100%`; its inner
  `.cm-math-body` scrolls horizontally. The conversion container is that inner
  body, not the content element, so a wide intrinsic SVG cannot widen `.cm-content`.
  `.cm-content` itself keeps `min-width: 0` inside the flex document column.
- An inline formula converts against the content box of `view.contentDOM` (padding
  subtracted once). Its inline-block root contains all inner SVG fragments in one
  CM widget rectangle, so MathJax's internal wrapping does not introduce anonymous
  inline breaks with an undeclared `WidgetType.lineBreaks` count. The shared
  source-line rule in `lists.css` stops inherited Q/L indent for every inline
  presentation; the root has no formula-specific indent reset and keeps the
  column-width limit. The host retains
  the surrounding text line-height and native baseline. Only its direct MathJax
  SVG container has `line-height: 0`, so a MathJax font-size adjustment cannot
  introduce a second, scaled text strut. SVG height and negative vertical-align
  still contribute the formula's actual ascent/descent: small inline formulas
  fit the normal text line; genuinely tall formulas may expand it. Pending/error
  source text keeps the host's natural text line-height. This is a persistent
  layout rule shared by Live/Reading MarkdownView, without per-toggle spacing,
  height memory, clipping or changes to display formulas. The 2026-10-23 inline
  spacing correction initially had source/diff review only; its remaining source
  font-metric mismatch is now measured and fixed below. See rendering-unification.md for the B2 click investigation
  and its unverified runtime boundary. The inline tooltip keeps CodeMirror's
  default fixed positioning, sizes to `max-content` with a bounded width, and scrolls inside its
  own body. Restoring absolute positioning or a shrink-to-fit root inside the
  editable DOM risks coupling width and position again. This is a source-supported
  feedback risk, not a confirmed runtime explanation for either reported jitter.
- Raw TeX source inherits the surrounding font style, as well as its font family,
  size and line-height. Do not apply blanket italic styling to `.cm-math`:
  the bundled MathJax_Main italic face has different baseline metrics from the
  normal face. At 18px / 1.5, mixing these two faces made a 27px text line grow to
  28px on source reveal even with the same computed 27px line-height. Removing
  that style restores the normal text metrics without offsets or compensation;
  formula-local token colors and explicit concealment styles remain owned by
  their existing syntax/concealment extensions. A tall rendered SVG and wrapped
  source still take their natural height. The 2026-10-24 isolated renderer tests
  now verify source reveal/restoration, mouse clicks, scrolling, 16/18/24px,
  light/dark, list/quote contexts and Live/Source/Reading modes. This establishes
  the reproduced 1px source-font cause; the previous output-container reset
  alone did not fix it. See tests/reports/inline-math-20261024.md for evidence.
- `livePreviewPlugin` coalesces initial mounts, `docViewUpdate` and geometry
  changes into one keyed `requestMeasure` per view. It reads only mounted formula
  roots belonging to that view, excluding nested fragment editors. Each DOM-owned
  mount compares effective container width and `em` against its last request.
  Unchanged metrics reuse the current or pending SVG conversion. Changed metrics
  abort the old subscriber and use the original queue/cache with the new snapshot;
  configuration invalidation still forces conversion at the same dimensions.
- Completion requests one further measure (scrollbar/height). That measure can
  read metrics again but cannot restart conversion when they are unchanged. No
  timer or per-formula ResizeObserver is added. Hidden zero-width hosts wait for
  their next geometry update rather than converting at the fallback width.
- The inline tooltip uses its existing mount/update hooks and keyed request to
  compare the same metrics on geometry changes, keeping CM's root/arrow and the
  existing transient conversion/disposal behavior.

Window and split resizing now invalidate the mounted output when the effective
conversion width changes, without recreating the widget or changing the note.
This is source implementation only: no tests, typechecks, builds, probes or
app/server/browser acceptance were performed. Actual TeX reflow, jitter behavior
and performance remain unverified; no single runtime root cause is claimed.


Syntax colors come from the existing formula-local Lezer tree, including control
sequences, numbers, operators, delimiters, environments, literal text and comments.
Only visible source formulas need marks. Positioned trees are cached by immutable
MarkdownModel, body range and configured math languages, so selection-only states
reuse the same tree and token marks. The existing bounded source-tree cache and
MathJax cache remain authoritative; no second parser or macro cache is introduced.

The user explicitly prohibited acceptance/tests for this opinion batch. Only
source and Git diff inspection were performed; no new tests were authored and no
typecheck, build, fixture, application, server or browser was run. UI, rendering,
IME and performance behavior for these changes remain unverified.

## Module map

- Core `math`, `syntax`, `tables`, `properties` and `source`: shared formula
  regions, parser fragments, table/YAML reuse and minimal source patches.
- Client `writing/config`, `extensions`, `matching`, `editing`: one configuration
  lifecycle, native CM extensions, bounded trigger matching and session history.
- Client `writing/format`, `analysis`, `commands`: rule orchestration and the
  positional adapter over the existing Markdown model, with native commands.
- Server `services/writing` and `routes/writing`: native Vault JSONC persistence
  and explicit empty snippet-file creation through shared VaultConfiguration IO.

The adapted upstream rule/TeX algorithms keep their MIT attribution and are
isolated from plugin lifecycle/UI implementations. The 65 Linter rules are
available, including the snapshot's 29 enabled rules and 46 custom regexes.
Large spelling data loads only when correction is enabled. Native settings own
formula/snippet options and formatting rule categories. Original LaTeX Suite and
Linter instances are skipped by the plugin loader, avoiding duplicate handlers.

## Acceptance boundary

Current verification is static only: types, source review and isolated builds.
Do not start browser/Electron/server or modify the live Vault, server/public or
existing release packages. Prepare regression cases without executing runtime
tests. UI, actual input, IME and performance remain user acceptance.

Regressions: current mk/dm/chemistry/function/visual snippets; nested/synchronized
tabstops and undo/redo; manual versus automatic saves; formatting idempotence at
fixed time; all imported regexes and escapes; YAML comments and unknown values;
Callout/list/table/code exclusions; mhchem internal dollars; conflict/stale
results; independent split selections; ignored paths and no duplicate plugins.

2026-10-22 static evidence: core/server/web/desktop types and isolated production
web/server bundles passed. Regression cases were prepared for all 46 imported
replacements, dollar/backslash/capture semantics, source patches, shared formula
regions and history; they were not executed. Adapted legacy algorithms retain
`@ts-nocheck`; new host boundaries and the shared template compiler are type
checked. No actual typing/IME, UI, migration execution or performance acceptance
is claimed, and no new desktop executable was built.

## 2026-10-23 configuration file settings

Advanced writing settings now use the current Vault's
`.obsidian/webobsidian/writing.jsonc` through the existing VaultConfiguration IO.
The file owns version/migration/latex/linter/hotkeys; `/api/writing` returns its
source/revision along with the existing effective math profile. Missing native
files use native defaults; the former app/plugin fallback has been removed.
Opening Settings does not create the native file; an explicit save/create action
writes it exclusively, and subsequent UI saves carry the source revision and Vault
token. External edits reject stale saves rather than overwriting them. Invalid
JSONC/schema keeps the client's previous compiled settings through the existing
refresh failure path. Native replacementSyntax stays latex-suite-v1; no runtime
legacy replacement conversion is performed.

The same watcher/configuration notification now recognizes writing.jsonc and uses
refreshWriting. There is no added watcher, settings store, snippet compiler or
editor hot-path work. Ordinary toggles/formatter row controls still call
updateWriting; complex arrays/regexes/JS/JSON are edited externally. The old
JsonEditor and rule-specific nested details/cards are removed. Formula/format
behavior, rule ordering and source-range patches are unchanged by this UI change.
This batch has source/diff review only, without types/build/tests/runtime.

## Native snippet directory (2026-10-23 follow-up)

The application owns `.obsidian/webobsidian/snippets/` under its existing native
configuration root. The default source is this directory, with zero snippets when
it is absent. Startup neither creates the directory nor copies upstream examples
or the user's old personal library. The unused upstream example corpus was removed.
The variables parser and snippet compiler remain the same authoritative engines.

`writing.jsonc` is the sole active writing configuration. Its absence no longer
triggers LaTeX Suite/Linter/plugin hotkey reads, app-settings migration or app writes.
Existing explicit source paths (including supported desktop absolute paths) and
inline definitions in that native file remain user choices; no bulk rewrite occurs.
Clearing the path field restores the native directory. A deliberate empty-file
create action creates only `snippets/snippets.js` with `export default [];` through
VaultConfiguration's existing Vault token, create-only and revision safeguards.
An existing file is returned unchanged; normal file open never creates content.
The existing native configuration watcher handles edits; no extra watcher/index,
path service or parser is added. Explicit missing external paths still report errors.

Old personal/plugin/app files are never moved, deleted, overwritten or converted.
Any future import must be explicit; the old mandatory importer is deleted rather
than retained as a dormant fallback. This follow-up is source/Git/document review
only, with no tests/types/build/probe/app/server/browser/UI acceptance or new package.
