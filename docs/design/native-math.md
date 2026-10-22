# Native MathJax packages and preambles

## Ownership

MathJax 4.1.3 owns TeX expansion, MathML construction and SVG layout. The existing
`mathjax.ts` owns loading, configuration candidates, conversion scheduling,
pending-request deduplication, the 256-entry output cache and output adoption.
All hosts use `renderMath`; no package owns a second renderer or cache.

The pure `markdown-core/mathPackages.ts` directory is shared by runtime,
persistence, asset build and editor argument metadata. A package declares its
native MathJax component, dependencies, conflicts, optional command information
and any structured-cloneable context state outside TeX's macro namespace.
MathJax remains pinned; its component constructors and command-map enumeration
are localized behind the adapter in `mathjax.ts` and reviewed on upgrades.

Keep three distinct responsibilities: MarkdownModel/MathRegion locate formulas;
the formula-local Lezer tree handles incomplete editor input; MathJax interprets
and typesets completed TeX. Do not merge these parsers or derive source from DOM.

## User configuration

`/api/writing` includes the effective math configuration and its Vault JSONC
source/revision. The source is `.obsidian/webobsidian/math.jsonc`. The existing
Vault-configuration/text-file implementation supplies JSONC handling, create-only
writes, compare-and-swap revisions, path confinement and Vault identity checks.
No second settings store, file watcher or command manager is added.
The existing watcher traverses only `.obsidian/webobsidian` within the otherwise
ignored Obsidian directory. Its `vault-configuration-changed` notification bypasses
note indexing and tree refresh, and is available to other native configuration
consumers. Preamble files outside hidden directories use existing file events;
hidden preambles should live under `.obsidian/webobsidian` for automatic refresh.

The source contains package choices/options, one Vault-relative preamble path
and optional inline TeX definitions. File definitions run first, inline definitions
second. TeX commands control explicit redefinitions; source is never rewritten.
The settings draft does not take effect until a candidate parses successfully.
Saving retains JSONC comments and unknown syntax data subject to the schema.

When no native file exists, reading imports data from enabled
Local LaTeX Renderer (`mathJaxPreamble`), or Extended MathJax (`preamblePath`).
This is a data-only default: reading writes neither Vault nor plugin data.
The explicit Save action creates the native configuration. Original files stay
intact. Local LaTeX Renderer's `compilerPreamble`, LuaLaTeX/dvisvgm execution and
code-block processors remain separate. Its duplicated `initializeMathJaxPreamble`
is bypassed, with a feature check, while the original Extended MathJax plugin is
marked built-in. Changing the old plugin's macro textbox no longer changes
native math; use native math settings.

## Configuration lifecycle

1. Read settings and the selected preamble using the existing Vault adapter.
2. Load selected native components and construct a candidate TeX context.
3. Apply labeled preamble segments. TeX errors reject the candidate; diagnostics
   include the source and a line when supplied by MathJax's parser.
4. Prepare editor metadata/snippets if their inputs changed. Linter-only changes
   do not rerun snippet modules; math changes do not recompile Linter rules.
5. Persist an explicit save with its original revision, then publish the candidate.
   File refreshes do not persist. A newer file event invalidates an older save's
   candidate and forces a fresh read before publication.
6. Advance the effective revision, clear output cache and notify mounted formula
   hosts. Failed candidates preserve the previous effective configuration.

Candidates which lose the generation race or fail persistence are disposed.
Pending conversions verify the effective revision before caching/applying output.
The MathJax 4 Promise conversion already serializes its document work; the one
application queue adds cancellation-before-start and an 8ms inter-formula budget.
It cannot preempt a synchronous long conversion.

## Formula state and previews

Code/fonts load once. Ordinary formulas reuse the baseline configuration context.
The existing mathRegions model derives earlier definition formulas in source
order. Only distinct definition prefixes need additional contexts, bounded to
16; they do not depend on scrolling, virtual mounting or conversion order.
Hosts with fragments pass their full-source `mathSource` projection. There is
no extra whole-Vault body cache.
Table-cell host equality uses these definition prefixes and referenced-equation
presentation data, so a plain paragraph edit does not rebuild every table.

Each conversion starts a MathJax `begingroupSandbox`; macro/global definitions
cannot escape into the next conversion. Packages may also keep state outside
the macro namespace. Their declared option/data fields are checkpointed after
the preamble/prefix and restored before each conversion. `siunitx` restores its
options and unit maps; `color` restores its model's user-color Map without
cloning or replacing the ColorModel prototype. New packages must declare their
own relevant state, or use a different explicitly reviewed reset implementation.
The descriptor is not a sandbox for arbitrary JavaScript.

`mathtoolsset` can mutate handler configuration in addition to options, so it is
disabled in formula input. Use `packageOptions.mathtools` instead. The existing
begingroup sandbox restores normal macro definitions; a generic clone of the
whole parser is deliberately avoided.

`transient` avoids long-lived preview-output caching. It shares the same reset
rules, so cursor previews do not commit definitions, options, labels or counters.
MathJax tags remain `none`; native equation numbering/reference semantics belong
to the document/source module, independently of the SVG cache.

The source-order effects scanner recognizes native definitions and package
`stateCommands`; it is conservative and is not a TeX expansion parser. Definitions
intended for broad reuse should live in the preamble. An arbitrary alias hiding
a state-setting command is not inferred as a cross-formula declaration.

## Editing and output

The MathJax context supplies its command names once during configuration
construction. This replaces the old MathJax 3.2 command-name snapshot. Each
snippet compilation receives its own `ALL_MACROS` compatibility array, so `.push`
cannot pollute future reloads. New snippets can use `hasMacroPrefix`.
Shared argument metadata protects literal, chemical and unit arguments from
ordinary math snippets. Unicode conceal remains optional editor presentation;
it never substitutes source text or implements a package's semantic algorithm.
Cursor decoration also checks the effective command Set; disabling the HTML
package keeps the raw preview instead of injecting an unavailable `class` command.

Core source segments provide tooltip offsets and quote-prefix removal. The code
context consumes core blockContainers/MathBounds rather than splitting fences
again. `forceMathLanguages` remains an editor-input option: it does not silently
turn full `latex`/`tex` local-compilation blocks into MathJax formulas.

SVG glyph IDs are rewritten per clone, including print documents. Styles travel
with the selected output document. Public render payloads carry only the enabled
package options and macro definitions needed by the shared formulas; no private
preamble path or unrestricted Vault file-reading capability is exposed. Public
clients import no authenticated settings/Vault module through this path.

## Packages and extension work

The local component set includes mhchem, mathtools, bussproofs and other selected
MathJax extensions. Physics is opt-in and conflicts with braket and siunitx.
Physics also defines dd; review personal macros when selecting it.

siunitx-pcc is vendored at a pinned upstream revision with its Apache-2.0 license.
It is a partial implementation. Its two old global parser-patch imports are
disabled because 4.1.3 already implements those methods. The component links
to the host's MathJax exports and is loaded only when enabled. See its README
and `docs/examples/math-packages.md` for update and extension guidance.

Not included: package marketplace, arbitrary Vault JavaScript extension loading,
folder/note profile selection, TikZ/chemfig backends, complete TeX compilation,
or a new automatic-numbering mechanism. These do not change the package contract.

## Verification

Static-only: scoped source types, isolated core/server/web/desktop compilation,
production web build and standalone-server bundle checks. Regression sources are
prepared without execution. Actual macro migration, rendering, package output,
hot reload, IME, split views, public share, printing and performance remain user
acceptance. No real Vault writes, app/server/browser launch or portable package.
