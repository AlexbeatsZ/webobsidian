# Native body-local headings

## Contract (2026-10-22)

`####### 标题` replaces the personal `> **标题**` convention recognized by
Obsidian Plus custom-heading references. Exactly seven hashes plus a space/tab
(or an empty title while typing) define a single-line body title. Eight hashes,
seven without a separator, code, HTML blocks, comments and YAML are not indexed
as titles. Inline Markdown and optional ATX closing hashes are supported.

The presentation follows the copied STEM Theme.css: ordinary body font size,
the existing bold weight, a neutral 3px text-color rule and 24px inline padding.
It has no H1–H6 label or larger structural-heading typography. Live editing,
reading, note embeds, Canvas and print all use MarkdownView. Editable title text
remains native CodeMirror content; only the hash markers are concealed away
from the active line. Reading never reveals them. Line spacing uses measured
padding rather than margins. The no-JavaScript public fallback uses the same
title classification and theme class.

## Parsing, formatting and references

- `markdown-core/bodyHeadings.ts` defines one `BodyHeading` Lezer extension for
  the shared source grammar and CodeMirror language support. It interrupts an
  ordinary paragraph and retains quote/list containers and source positions.
- Shared `extractMetadata` includes these titles with `level: 7, kind: body`.
  Seven is a metadata/section-boundary rank, not a structural Linter level.
  Existing catalog search, current-document heading search, `[[note#title]]`
  completion/navigation and `![[note#title]]` fragment embeds reuse this metadata.
  Body fragments end at the next body title or any H1–H6 title; normal heading
  fragments retain their existing section boundaries. Duplicate names and
  inline-title matching retain the normal heading behavior (first matching title).
- Linter's common structural-heading matcher explicitly accepts only H1–H6.
  Header Increment neither changes seven hashes nor feeds these titles into its
  level mapping. The writing AST gives them a distinct `bodyHeading` type, so
  AST heading visitors also exclude them. General whitespace/body formatting and
  user-authored custom regexes keep their configured scope.
- Catalog cache schema 3 invalidates older snapshots which did not index body
  titles, reusing the existing rebuild lifecycle rather than another index.
- SSR replaces only the seventh hash with an equal-length space in its temporary
  rendering input, selected from the shared grammar. Remark keeps inline markup
  and container structure, then emits a sanitized `div.body-heading` with
  `role=heading, aria-level=7`. Saved source is never rewritten for display.

## Usage and migration boundary

```markdown
####### B.O.近似
正文内容。

[[量子化学#B.O.近似]]
[[#B.O.近似]]
![[量子化学#B.O.近似]]
```

The editor format menu also inserts a body title. Existing `> **标题**`, legacy
Plus `#-...` links and block identifiers are preserved; this change does not
mass-convert the Vault or reinterpret arbitrary bold quotations. New titles
use normal heading fragments without a separate Plus reference registry.

## Verification boundary

Static verification only: isolated core/search/web/server types and production
web/server bundles; regression sources cover exact syntax, incremental edits,
literal exclusions, section boundaries, Linter mappings and SSR sanitization.
Core/search compilation, complete web/server types, regression source types,
production web and standalone server bundles, the relative-require guard and
generated server syntax checks passed on an isolated staged-source snapshot.
The web build retains its existing large-chunk warning; no runtime size/speed
acceptance is inferred. Those regression cases are prepared but not executed. No browser, Electron,
server or real Vault is opened or modified. User typing/IME, actual navigation,
visual parity and performance acceptance remain pending. No portable build.
