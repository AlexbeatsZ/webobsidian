# Native writing implementation

Application-owned modules are `config`, `analysis`, `matching`, `editing`,
`extensions`, `format` and `commands`; the existing document session and MathJax
service own text/history and rendering. No original plugin instance is loaded.

`latex/` adapts artisticat1/obsidian-latex-suite tag **1.14.0** (MIT), retaining
snippet semantics, TeX grammar, bracket/conceal algorithms and defaults. It
replaces whole-document/background parsing with the host Markdown model and
formula-local trees, replaces Obsidian services with direct host calls, removes
Vim/matrix/Excalidraw integration, and attaches tabstop restoration to session
history. The original license is in `latex/LICENSE`.

`linter/` adapts platers/obsidian-linter tag **1.31.2** (MIT), retaining all rule
implementations, execution ordering and option metadata. Custom replacements use
the same LaTeX template compiler as snippets; legacy escaping is converted once
by the server importer and is absent from the runtime rule runner.
The positional AST vocabulary is adapted from the host model; there is no mdast
Markdown parser or independent parser cache. Option objects contain metadata,
not Obsidian widgets. The dictionary loads only when correction is enabled.
The original license is in `linter/LICENSE`.

Upstream algorithms were written with different compiler settings; legacy files
carry `@ts-nocheck`. Newly written host boundaries and generated parser code are
type checked. Runtime equivalence is not implied by either types or bundling.
Regenerate TeX tables with `npm --workspace web run generate:tex`.

See `docs/design/native-writing.md` for migration, operating boundaries and
pending acceptance. Current work permits static checks only; regression sources
are prepared but are not executed by this migration task.
