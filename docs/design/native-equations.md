# Native equation numbers and block references

## Source contract

Formula references use the `eq-` block-ID namespace and ordinary wiki links:

Vault-global stable references additionally accept `[[^eq-ID]]` and `![[^eq-ID]]`.
They reuse the same formula anchor/type rules and full source-document numbering;
global duplicate IDs are unresolved, not silently selected. Existing `[[#^eq-ID]]`
and `[[file#^eq-ID]]` remain document scoped. See `content-references.md` for
catalog lookup, copying/moving identities, and source-session embedded editing.

```markdown
$$
E = mc^2
$$ ^eq-mass-energy

由 [[#^eq-mass-energy]] 可得……
```

The source name on the equation and in the link must visibly match. The three
display forms are distinct:

| Source | Display |
| --- | --- |
| `[[#^eq-migrated17]]` | Current equation number, e.g. `(1-17)` |
| `[[#^eq-migrated17\|]]` | `migrated17`, the text after `eq-` |
| `[[#^eq-migrated17\|energy]]` | `energy`, the explicit alias |

Whitespace-only aliases count as empty. `equationReferenceName` owns the allowed
namespace, `equationReferenceLabel` owns this display rule, and `equationTarget`
resolves only canonical IDs. Generated names use `eq-` plus a short random token,
checked against **all** block IDs in the target document.
The name is assigned once; changing the formula never regenerates a content hash.
Duplicate IDs are ambiguous, including duplicates on ordinary blocks.

Typing `[[#^eq` or `[[note#^eq` in the existing link suggester lists referenceable
display formulas, whether or not they have IDs. Search includes number, name,
TeX and H1 context. The selected candidate alone uses the shared MathJax preview;
the list does not convert every formula. Results use the existing 20-item limit;
searching narrows the complete candidate set. Formula-mode completion contains
only referenceable formulas with a canonical ID or no ID yet; it never mixes in
ordinary blocks. Selecting a formula reuses its canonical name or adds an ID at
its closing delimiter. Browsing never modifies source. Generic `#^` completion
continues to serve ordinary block links. A noncanonical formula ID must be
normalized explicitly; the application does not rename IDs or revive old formats.

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

Display formulas retain intrinsic width, including overflow beyond the document
column. The MathWidget host grows with its SVG and automatic label; its three-column
grid centers short formulas and puts the label after long formulas with a real gap.
Do not restore absolute-positioned labels, fixed horizontal reservation, SVG
max-width, or a separately scrolling formula body. The editor scroller owns
horizontal navigation. Explicit TeX tags remain MathJax-owned.

MathWidget measures the parent source line, not its expanding body, for conversion
metrics. This prevents output width from feeding back into repeated conversions.
The existing queue/cache/cancellation and view-local lifetime remain authoritative.
The 2026-10-25 feedback regression covers automatic/explicit labels, source previews,
reading, print DOM, nested contexts, resize and cancellation. Browser evidence is
not installed-package or OS-print acceptance; see
`tests/reports/feedback-equation-number-20261025.md`.

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
when the selected source slice is unchanged. Labels use original source numbers;
there is no unused embed-ordinal prefix option.

Every canonical formula link, including links with empty/custom aliases, exposes
a rendered hover preview. The existing CodeMirror hoverTooltip owns positioning
and lifetime. `mathTooltip.ts` shares the render/measurement/configuration-change/
abort lifecycle with inline cursor previews; both call the existing MathJax
queue/cache. Reference previews use the target's complete model and absolute
formula position for macro definitions. Widget-owned weak DOM metadata is only
read on hover; no source scan, MathJax conversion or new watcher runs per mouse
move or ordinary text input. Local labels participate in normal widget equality;
hover reads the current semantic model lazily, so an unrelated document revision
does not recreate every link or restart cross-note subscriptions. Unmount clears
metadata/subscriptions. Loading or
render failure uses a status message; no TeX source is written into `title`.

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

## Legacy and migration

The application has no `#=(number)` / occurrence-suffixed formula resolver,
tag-to-reference index, arbitrary-ID formula-reference branch or unused numbering
prefix. Legacy source interpretation belongs exclusively to the offline migration
script. Generic Markdown links, headings and ordinary block navigation remain
their own existing capabilities. Explicit TeX `\tag` is still ordinary formula
presentation, independent of link identity. The application never migrates a
Vault or changes external plugin files/configuration on startup.

Cross-file formula discovery reads only the selected target through the existing
resolver and DocumentRegistry. There is no extra full-Vault equation index,
catalog cache schema, watcher, database or API endpoint.

### Explicit offline migration (2026-10-24)

`scripts/migrate-equations.mts` provides an opt-in, offline vault migration;
[usage and recovery](../examples/equation-migration.md) document its CLI. It imports
current markdown-core source through the existing project-local tsx dependency,
reusing SourceDocument, mathRegions, equations/equationAnchor,
metadata, comments and TargetIndex. No application startup, automatic migration,
second Markdown parser, watcher, render engine or live editing path is added.
The removed legacy tag/occurrence lookup now lives only in this offline script.
Noncanonical formula block IDs are renamed into the `eq-` namespace and their
incoming block links are updated in the same migration plan.

The planner allocates stable IDs for legacy tagged formulas, resolves references
against the original snapshot before removing numeric tags, then applies source
range patches. Existing untagged formulas are already native and are untouched.
Wiki links/embeds, independent inline number references and parser-owned Markdown
URL ranges migrate together; file selection includes inbound links from other
notes. Custom aliases remain literal unless removal of matching numeric aliases
is explicitly requested. Custom tags and numbering exemptions remain explicit.

Preview is the default and outputs original/result copies, a diff, a report and
a self-contained HTML source comparison outside the source Vault. Explicit apply
requires zero unresolved issues and a still-current whole-Vault snapshot. It
backs up all original bytes before any per-file atomic replacement. Restore
checks current bytes against original/result copies and refuses to overwrite
later edits; journal states support recovery after an interrupted partial apply.
The CLI requires a new output directory and rejects symlinks and invalid UTF-8.
Unresolvable references/duplicate IDs/unsafe formula closings are reported rather
than guessed. There is no claim that arbitrary damaged old notes can be fully
migrated automatically. This user request authorizes targeted migration-script
execution on copies; application/UI/MathJax acceptance is separate.

## Verification boundary

2026-10-24 canonical-reference/hover follow-up is source/diff review only under
the existing no-acceptance boundary: no tests, typechecks, builds, application,
server or browser launches. Existing unit sources were updated for the canonical
namespace and the three alias states but were not executed. The earlier migration
script's 14 executed checks predate this follow-up and do not verify it.

Earlier regression sources cover identity after renumbering, H1 rules,
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
