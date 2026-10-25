# Vault-defined block effects

## Built-in query and fence selection (2026-10-25)

`queryBlock.ts` registers the built-in query language through the existing code
processor registry during native host startup. It reuses `api.search`, search-core
query parsing, search refresh notifications and the render child lifecycle. It
does not execute note content or create another search index/parser/watcher.
Returned titles/snippets are text nodes; abort and teardown prevent stale output.

This is a deliberately partial query implementation: one search word, tag include/
exclude filters (including descendants), and a relative `path:` token. Path searches
retain the application's existing tokenization/fuzzy/prefix semantics; the UI says
so. Multiword, phrase, OR/grouping, regex and property searches are explicitly
unsupported rather than silently executed with different meanings. Full Obsidian
query compatibility remains open. Broad matches must be capped with a visible
truncation notice, not synchronously expanded into an unbounded DOM.

All processed code blocks share the selection intersection rule for source reveal;
processors can request a closed fence with `requiresClosed`. No language-name
condition belongs in the shared renderer. In ordinary editable code blocks,
transparent formatting marks retain original fence text and native hit testing;
touching the block reveals it. Reading mode still hides fences. Lezer CodeMark
nodes own fence identity, replacing the old line regex. No extra input/coordinate
pipeline is introduced. See `tests/reports/feedback-code-query-20261025.md` for
browser coverage and the remaining native-package/server acceptance boundaries.

## Accepted scope (2026-10-22)

`[name]` applies a Vault-owned definition to the next Markdown block. Multiple
names use `[name|other]`; only explicitly registered names activate. Missing
configuration is empty and inert. Do not import AnyBlock code, default converters,
aliases, styles, parsers or its diagram dependencies. The existing STEM usages
are registered only in the disposable Vault, with their original source intact.
User CSS, scripts, command definitions and templates belong to the Vault, not
application settings or installation resources.

QuoteMark nodes are container punctuation, not target blocks or list-item text.
Skip them when choosing the next same-parent block and extracting list bodies;
the source ranges and quote prefixes remain in the shared model.

## Architecture and implementation sequence

1. Reuse the command/template Module's `vaultConfiguration.ts` for UTF-8 JSONC and
   relative asset reads, Vault identity, path confinement and revision handling.
   Blocks live in `.obsidian/webobsidian/blocks/blocks.jsonc`. Automation lives in
   `.obsidian/webobsidian/automation.jsonc`; menu files keep their existing folder.
2. Extend the one Lezer grammar with a standalone marker node. Derive its next
   sibling and parent/source ranges from the existing immutable MarkdownModel;
   cache discovery and list hierarchy there. Exclude code, YAML, math/comments.
3. Bind registered names once per model/configuration revision. CSS uses measured
   BlockWrapper ranges; original editable text and native table controls remain.
   One optional JS definition owns the target replacement; every native builder
   queries the same ownership function to avoid overlapping replacements.
4. Share `javascript/execute.ts` and the extracted `javascript/lifetime.ts` with
   native JS blocks. Do not import chart/widget installation into effects. Each
   mounted effect owns cancellation, declared dependencies and cleanup. Generated
   Markdown reuses mountFragment and recursively denies executable output.
5. Compile changed script source on explicit reload, map widget identity through
   edits, and keep equal-source siblings independent. No polling, DOM rescanning,
   second Vault watcher, parser, Markdown renderer or table parser.
6. Register only observed existing names in the test Vault; document migration,
   then check source types and isolated production bundles. Do not run tests,
   applications, a browser/server, write the original Vault or package a release.

The new Module's Interface is configuration + reload + block context. Deleting
it would scatter block selection, ownership and script cleanup into native
builders, so these behaviors provide Depth and Locality. A conversion graph,
intermediate type system and per-effect engine would add no current Leverage.

## Configuration

```jsonc
{
  "version": 1,
  "definitions": [
    { "names": ["my-card"], "classes": ["my-card"], "stylesheet": "cards.css" },
    { "names": ["my-view", "my-alias"], "script": "view.js" }
  ]
}
```

Paths are relative to the blocks directory. Assets may be subdirectories but
cannot escape it. Entries may combine classes, stylesheet and a script. Repeated
names are rejected. A pipeline may contain any number of CSS definitions and one
JS definition. Unknown names or multiple JS owners preserve visible source.
No file is generated automatically. Configuration/CSS/JS changes under the blocks
directory reuse the existing `vault-configuration-changed` watcher/WS event and
coalesce into one reload; other file extensions and unrelated configuration are ignored.
The native `blocks:reload` command also reloads explicitly. Unchanged script source
retains its compiled function and mounted identity. Switching Vault cancels the
pending reload and detaches subscriptions on disposal. No second watcher, polling,
note indexing or file-tree refresh is added. Reload is atomic; invalid definitions deactivate previous
definitions and report the error instead of continuing obsolete user code.

Scripts are function bodies receiving `block`: app, container, source, sourcePath,
model, range, node, list(), table(), signal, component, onCleanup, watch,
renderMarkdown and renderSource. A returned string renders as Markdown; a returned
function registers cleanup. No user code executes while loading configuration.
`list()` and `table()` expose the same source model, not reparsed text. Relative
links/formulas/embeds use the source note's existing RenderContext.

## Presentation and capabilities

The target is the next grammar sibling in the same quote/list container, not an
arbitrary DOM element or an inferred section. A paragraph, table, complete list,
quote/callout or code block is one target. Multi-block regions/section selectors
and AnyBlock's full legacy syntax are outside this first Interface. Pure CSS
continues native editing; JS output has a source entry for exact source editing.
Source mode never runs effects. YAML/code/math/comments and unregistered bracket
text remain source. Private reading permits trusted JS, matching JS blocks.
Public shares do not load private Vault definitions. Print/generated output may
use already loaded CSS definitions but never executes user JS, including embeds.

User scripts are trusted code with existing app access. Abort/cleanup manages
registered resources and stale helpers; it cannot preempt synchronous loops or
undo arbitrary global side effects. CSS is user-authored trusted CSS. Use padding
for wrapper spacing; CM does not measure collapsed margins between children.

## Verification

An own-source snapshot based on the committed automation/configuration Module
passed fresh core/search compilation, web/server/desktop types, prepared block
and JS regression-source types, isolated production web and standalone-server
bundles, the relative-require guard and generated-server syntax checking. Existing
large-chunk warnings remain. The seven new regression cases were typechecked,
never executed. Personal JSONC and asset paths plus the two script bodies passed
static format/syntax inspection; the scripts were never executed.

Source-text inventory in the test Vault found 1,237 marker lines in 153 Markdown
files: 1,207 nowrap headers (31 inside quotes), 24 exTable headers (23 combined
with nowrap), four list2table and two table aliases. This is textual inventory,
not a claim that every line is an executable effect. The disposable Vault alone
has three registrations/four names. These remain personal Vault files, excluded
from the application Git commit and packages. No original note was rewritten.

The Plus 1.3.x adapter also suppresses its AnyBlock child; independent `any-block`
and `any-block-local` IDs report native replacement. Original plugin files/data
and enabled flags remain intact. Vaults without selected registrations therefore
show unregistered source rather than silently installing the legacy defaults.

Runtime, lifecycle, input, visual parity, printing and measured performance remain
for user acceptance. No actual speedup is claimed from the caching design alone.
