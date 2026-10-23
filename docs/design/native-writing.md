# Native writing tools

## Contract

LaTeX Suite 1.14.0 and Linter 1.31.2 supply the behavior baseline. Snippets,
formula input/presentation and document formatting are native features, sharing
the existing document session, source changes, syntax model and MathJax service.
Do not load the original plugins as well. Preserve their files and Obsidian
enablement. Preserve upstream MIT attribution for adapted source.

Keep the configured snippet file as the editable rule source. Import settings
once per Vault; existing native settings take precedence. Conceal defaults off;
other retained visual/input features default on. Exclude matrix input shortcuts,
automatic input-method switching and Vim. Matrix template snippets remain valid.
Normal IME composition handling remains necessary. Future Excalidraw formula
editors must consume these same native editing capabilities.

The LaTeX configuration facet must not process default settings inside
Facet.define's combine([]): CodeMirror evaluates it immediately, before cyclic
settings/math-context imports necessarily finish. Use an inert missing value and
one lazily cached fallback through the existing getter. Production-entry boot is
covered by tests/packaged-startup.mjs, beyond harness/type checking.

Body-local titles (`####### 标题`) are shared `BodyHeading` syntax, outside
structural H1–H6 formatting. The common heading matcher and AST heading visitors
exclude them; Header Increment must neither rewrite them nor use them to map
the following ordinary headings. General body/whitespace rules and explicit
custom regexes retain their configured scope. See body-headings.md.

Linter imports all rule settings, ordered custom regexes, ignore paths and
timestamp policy. Rules retain pre/regular/custom/post ordering. Paste formatting
is a separate entry point. Snippets and formatting share LaTeX Suite replacement
semantics; migration translates the old Linter replacement strings once.

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

`legacyReplacement.ts` is used only by the server's importer. It reproduces the
old Linter escape-decoding order and JavaScript substitution rules, then emits
native templates: `$1` becomes `[[0]]`, `$&` becomes `${MATCH}`, and `$$` becomes
a literal dollar with an explicit escape only when needed. Named substitutions,
two-digit capture fallback, prefix/suffix substitutions and literal tokens are
preserved. For the configured formula rules, `$1$$$2$$` becomes `[[0]]$[[1]]$`
and `$$$$$1$$$$` becomes `$$[[0]]$$`.

The imported settings carry `linter.replacementSyntax: "latex-suite-v1"`.
Unmarked existing native configurations are upgraded once; a marked configuration
is never reinterpreted as legacy. New edits always use the native syntax. The
original plugin JSON and snippet file are retained. This migration occurs when
the new application first loads the Vault's writing settings, not during a
build. A failed conversion does not persist partial settings. Unknown syntax
versions produce an error instead of silently changing meaning.

## Shared ownership

- Markdown core owns source ranges and formula regions. Formula-local TeX
  parsing is cached and reused by editing/presentation; no second Markdown
  parser is installed by the writing tools.
- DocumentSession owns text history, source preservation and saves. Formatting
  commits one change group; snippet state follows history/position mapping.
- Manual save formats once before persistence. Autosave, navigation saves,
  plugin writes and external changes do not trigger whole-document formatting.
- The timestamp rule's opt-in delayed update changes only timestamps, through
  one debouncer per session. Its imported setting is `never`; background autosave
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

The inline tooltip is derived directly in its StateField. No extra update effect,
microtask dispatch or second preview state machine is needed. Native safe visuals
are installed once by MarkdownView independently of user snippets/plugin execution.
Private writing settings retain their existing configuration facet/hot reload.
The settings page exposes syntax highlighting, edit previews, display previews,
bracket highlights and the preview cursor through the existing LaTeX settings.
`mathPreviewLivePreviewDisplay` now controls the document preview, with a true
default; an explicitly stored false remains respected.

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
- Server `services/writing` and `routes/writing`: authenticated per-Vault import
  and persistence, using the existing settings queue and Vault adapter.

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
