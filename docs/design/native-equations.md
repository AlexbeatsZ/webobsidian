# Native equation numbers and block references

## Source contract

New equation references reuse ordinary Markdown block IDs and wiki links:

```markdown
$$
E = mc^2
$$ ^eq-mass-energy

由 [[#^eq-mass-energy]] 可得……
```

The source name on the equation and in the link must visibly match. The rendered
link without an alias displays the current equation number; a handwritten alias
is preserved. A name need not start with `eq-`. Generated names use `eq-` plus a
short random token, checked against **all** block IDs in the target document.
The name is assigned once; changing the formula never regenerates a content hash.
Duplicate IDs are ambiguous, including duplicates on ordinary blocks.

Typing `[[#^eq` or `[[note#^eq` in the existing link suggester lists referenceable
display formulas, whether or not they have IDs. Search includes number, name,
TeX and H1 context. The selected candidate alone uses the shared MathJax preview;
the list does not convert every formula. Results use the existing 20-item limit;
searching narrows the complete candidate set. Ordinary blocks whose names start
with eq remain available as block candidates. Selecting a formula reuses its name or
adds an ID at its closing delimiter. Browsing never modifies source. Generic
`#^` completion lists existing block IDs; `#^eq` is a completion convention, not
a second link syntax or a reserved target namespace.

The candidate retains the exact source model used to show it. Selection rejects
a changed model, a conflicting target session and an ambiguous target file.
Same-document ID/reference changes are one CodeMirror transaction and session
history group. Cross-document insertion edits the target DocumentSession then
inserts the reference and saves the target through its normal writer; it does
not claim a cross-file atomic undo. Save errors leave the target draft available
and are reported. Existing aliases and opaque original bytes are preserved.

## Numbering and ownership

`markdown-core/equations.ts` derives formula identity, source ranges and display
numbers from the shared `mathRegions`, metadata and table analysis. Closed dollar
display formulas participate; inline math and ordinary code are not numbered.
Table formulas and formulas ending in the legacy `{{}}` exemption, or containing
`\notag` / `\nonumber`, have no automatic number. Explicit `\tag` values retain
their own presentation and remain readable. Formula-free H1 sections do not
consume a chapter number, following the existing numbering template. Notes with
no H1 use chapter 1. H2–H6 and body-local titles do not reset the count.

Counters walk ordered formulas/headings/tables once. The result is cached by
immutable MarkdownModel; caret/viewport changes do not recalculate it. Numeric
position lookup uses binary search. New references never use the current number
as identity, so insertion/deletion/movement does not rewrite reference source.

An existing ID is associated only with a formula's closing line or its immediately
following ID-only line in the same quote container. Distant IDs and ordinary
paragraph IDs are not reclassified based on their names. The shared fragment
resolver selects the exact formula and marker, rather than guessing a paragraph.
The existing link opening path now consumes the fragment and locates headings,
ordinary blocks and formulas through the same view registration.

Source dependencies are one-way: syntax owns comment/literal facts; math owns
formula boundaries; metadata consumes both and excludes formula bodies from
block-ID/link/tag extraction; equations consumes those results; fragments owns
selection. `fragmentRange` moved from metadata into `fragments.ts`, still exported
from the package root. No equations -> metadata -> equations recursion exists.

## Rendering and contexts

The existing MathWidget displays automatic numbers as a separate label. Numeric
changes do not enter the TeX cache key. MathJax stays configured with `tags:none`;
its conversion order, viewport, duplicate views and print copies do not own
numbering. Explicit source tags remain inside TeX and never receive a second
automatic label. Mixed handwritten tags retain their literal values, including
any manually chosen duplicate display numbers.

EquationContext carries absolute source positions, source revision and computed
numbers. Editor, MarkdownFragment, note embeds, Canvas and print use the same
widget. A fragment receives the original note's complete semantic context rather
than counting from one. Embed invalidation includes the context revision even
when the selected source slice is unchanged. The optional context prefix is a
display-only mapping; the default uses original source numbers. This delivery
does not add the old plugin's automatic embed-ordinal prefix policy or editable
note-embed controllers.

Table cells compare preceding macro definitions and equation reference display
data, not the whole source revision. Their existing table source/position checks
still cover cell edits and movement. Unrelated paragraph input therefore keeps
cell hosts alive; renumbering or a changed earlier macro refreshes their context.
Only tables containing wiki-link syntax depend on equation-reference display data.

MathJax configuration remains owned by `mathjax.ts` and the coordinated math
feature. Widgets subscribe to its configuration invalidation, cancel stale
renders and pass sourcePath / ordered preceding definitions. Private fragments
carry an in-memory original source model for these definitions. No second
MathJax runtime, output cache, DOM observer or formula-source fallback is added.

Public sharing computes numbers on the server's full model, then emits only
formulas within the granted range. Unshared TeX, chapter titles and full source
models are never sent to restore numbering. Reference links grant no extra read
permission. Cross-document display can reuse an already granted whole-note
embed; unavailable targets retain their readable source label.

## Legacy and migration

Existing `\tag`, `#=(number)` / occurrence-suffixed targets, ordinary block
references, custom aliases and original plugin files are retained. The shared
fragment resolver reads tagged-formula fragments; native new references use IDs.
The existing legacy Plus formula/live-reference modules remain enabled for their
remaining old synchronization and editable-embed behaviors. New ID references
do not depend on them. No real-Vault migration, automatic old-tag removal, bulk
reference rewrite or formatting-template execution occurs during startup/build.

Cross-file formula discovery reads only the selected target through the existing
resolver and DocumentRegistry. There is no extra full-Vault equation index,
catalog cache schema, watcher, database or API endpoint.

## Verification boundary

User authorization is static checks only: source/type checks and isolated
production builds. Regression sources cover identity after renumbering, H1 rules,
literal/comment/table exclusions, mhchem internal dollars, explicit tags, exact
fragments, duplicate IDs, ordinary-block collision, Callout segments and exact
BOM/CRLF undo. They are prepared and type-checked, **not executed**.

Browser/Electron/server startup, actual completion/typing/IME/navigation, visual
and performance acceptance, cross-file saves and public-share behavior remain
unverified. Running resources, live Vaults and existing portable packages stay
untouched; no new package is requested.

2026-10-22 evidence: own-source core/search compilation, web/server/desktop types,
eight prepared regression source cases, production web and standalone-server
bundles passed. The standalone relative-require guard and generated JavaScript
syntax check passed. Production retains the existing large-chunk and mixed
static/dynamic-import warnings; no runtime or performance result is inferred.
