# Built-in Chinese search and Vault catalog

## Contract

Chinese search is a core feature. Full spelling, initials, mixed Chinese/Latin
queries and polyphonic characters use `packages/search-core`; names permit gaps,
body matches are continuous. Traditional readings and explicit fuzzy-sound rules
are settings. Russian transliteration, shuangpin, Hover Editor and `linkText`
are excluded. There is no extra ribbon button or plugin search modal.

## Ownership

`VaultCatalog` owns saved file membership and note metadata (title, aliases, tags,
headings, raw links, property summary, snippet). It does not retain full bodies.
One `TargetIndex` resolves exact paths, with scope filtering before precedence and
ambiguity decisions. Graph resolution retains Markdown-only scope and its existing
attachment-node representation. No link resolution uses pinyin.

One MiniSearch instance owns original and phonetic fields. Phonetic bigrams are
generated over per-character pronunciation alternatives, retaining only adjacent
suffix state rather than whole transliteration products. Candidate documents are
verified with the shared matcher before becoming results. UTF-16 source ranges
drive body contexts. Arbitrary custom fuzzy-sound rules use the Han candidate
token as a conservative fallback; these queries can inspect many Chinese notes.
No second search library, persistent phonetic database or watcher is introduced.

`vaultindex` is the full-build owner: one file enumeration, one read/parse per
Markdown file, then synchronous publication of catalog/search/graph. The existing
file-update queue handles incremental mutations. Cache restore checks schema,
dictionary revision, root and file stamps; incompatible caches rebuild. Both
original and phonetic body indexing retain the existing 100,000 UTF-16-unit cap.

Frontend directory summaries are fetched once per index refresh and shared by
pickers and completion. Commands remain client registrations; heading search uses
the current DocumentSession. Workspace recent-file history is reused rather than
copied into search settings. Plugin MetadataCache remains a separate compatibility
adapter for source locations, unsaved state, event ordering and legacy resolution.

## Interfaces and compatibility

File and command palette layout and the shared `#tag`/`-#tag` grammar are
specified in [palette-search.md](palette-search.md). Both file and body search
consume the same search-core query parser; existing `tag:` forms remain aliases.

`GET /api/catalog` returns public file/folder summaries. Search and match-context
requests accept `mode=pinyin`; omitted mode remains literal for agent clients and
unlinked mentions. The main search panel explicitly opts in. Match results may
include `matchedField`/`matchKind`. Existing links, sharing and resource access
checks are unchanged.

Native Search settings own supported preferences. Startup reads legacy plugin,
template and shortcut JSON once if no native settings were saved; original files
are never rewritten. Malformed legacy JSON is reported, not overwritten. The
plugin loader refuses duplicate `fuzzy-chinese-pinyin` execution. Imported hotkeys
map to native actions and yield to existing application/plugin bindings.

Templates insert raw source at the captured editor selection; a changed editor
state during fetch cancels insertion. No Templater script evaluation is added.
Completion uses CM transactions and ignores composition; YAML tags and link
aliases/headings use the same matcher. Heading search includes unsaved changes.

## Validation boundary

Current work is static only: type checks and isolated production/bundle checks.
Regression cases cover mixed queries, polyphony, UTF-16 ranges, repeat matches,
literal isolation and name/body strategy. These cases are not executed under the
current restriction. UI, IME, actual Vault correctness, startup and performance
remain user acceptance; no measured speedup is claimed.

Manual acceptance must include rename/delete/rebuild parity, same-name ambiguity,
attachments/Canvas/shares, graph edges, tags/properties, unsaved headings, YAML
source preservation, old hotkeys and plugin-disabled operation.
