# Command and file palettes

## Presentation

Follow the user's native Obsidian reference: one compact 700px dialog, a single
52px input row with a clear/close control, neutral selected rows, and a quiet
keyboard footer. Commands use 32px rows with actual assigned shortcuts on the
right; pin actions appear on hover/focus or for pinned entries. Files use 48px
rows: title and blue tag pills on the first line, muted relative path below,
and configured recent-selection keys on the right. Tags are metadata beside
the title, never a second input, tab or column. Application dialogs use UI
typography and restrained match emphasis.

The same theme tokens serve light/dark modes. Width is capped to the viewport;
tags wrap behind a one-line clip, paths ellipsize, and the list scrolls within
the visible dialog. Arrow selection scrolls into view. Enter activates, Escape
closes, and composition events never activate commands. Alt+Enter opens a file
on the right. Shift+Enter creates a valid plain file name through the existing
Vault.create/template/folder-tag path; filter expressions cannot become names.
No unsupported shortcut from the reference is displayed as implemented.

Homepage file picking reuses this same palette for either sidebar. Markdown
opens in the requested sidebar tab; media (and legacy .canvas text files) retain
their existing central view owners rather than being hidden from the picker or
forced into a Markdown tab. Existing attachment-visibility preferences still apply.

## Keystroke performance (2026-11-01)

Picker ranking stays synchronous and exact, but each keystroke must stay cheap on
large Vaults and Android:

- `findText` keeps the original state semantics (query-offset states in Map
  insertion order, first-emitted match, tie rules) on typed arrays with
  precomputed suffixes. Pronunciation forms are cached per fuzzy-rule set instead
  of building a JSON key for every character.
- `matchText`/`findText` first reject a text whose reachable a–z letters (literal
  characters plus every reading) do not cover the query letters, or whose
  possible match starts (a character, a reading or its initial) exclude the first
  query letter. Both are necessary conditions for literal, continuous and gap
  matches, so results are unchanged. Masks are cached per text and per
  pinyin-enabled/fuzzy-rule table.
- `fileCandidates` caches matched entries per query text for one catalog array,
  settings object and non-text filter set. A query that extends a cached prefix
  only re-checks that prefix's matches; all matchers are monotone, so the result
  equals a full scan (`searchNarrowing.test.ts`). Catalog/settings replacement
  resets the cache.
- The palette ranks `useDeferredValue(q)`; the input never waits for ranking.
  Enter pressed before ranking catches up chooses the fresh first result.

Measured with 6,500 synthetic Chinese names (Node, desktop CPU): typing
`zhangsan` took about 45 ms per key before; now about 10 ms for the first key and
below 1 ms for later keys. An old/new comparison over 1,202,400 matcher calls
(including pinyin-disabled and fuzzy-rule settings in both cache orders) found no
output difference.

## Name matching and ranking (2026-11-01, PRD 1.20)

`matchText` (every name picker: files, commands, headings, folders, completion,
plugin `prepareFuzzySearch`) is a port of lazyloong/obsidian-fuzzy-chinese
`Pinyin.matchAboveStart` + `getScore`. The previous matcher ranked any literal
gap match above any pinyin match, so `rlx` put `fudan-vpn-docke**r**-c**l**ash-…-pro**x**y`
above `热力学…`; the user judged upstream's order better and asked for its logic.

- Match: two-row DP over UTF-16 units of the lowercased name. Each unit consumes
  the literal query character, a reading initial, a `zh`/`ch`/`sh` initial, or a
  whole reading; the last unit may consume a prefix of a reading (≤6 letters).
  Units may be skipped. Fuzzy-sound rules expand readings; pinyin disabled leaves
  literal characters only. Whitespace in the query is ignored.
- Score (higher wins): `100·coverage²` (matched units / name length) +
  `15/√(first+1)` + `25/segments` + `5·(len−1)` per continuous segment.
- `kind` is `pinyin` if any unit matched through a reading.
- The letter/start-mask prefilter and the prefix narrowing cache stay valid: the
  DP is monotone in the query and needs the same reachable letters.
- Body search (`findText`, server) is unchanged.

Measured with 6,500 synthetic Chinese names: a full scan costs about 6–8 ms per
key; narrowing makes later keys cheaper. Upstream's lazy path search (only when
title matches are few) is not adopted, because path matching here is an
explicit setting/filter.

## One query grammar

`packages/search-core/src/query.ts` owns tag names, hierarchy matching, token
parsing and field extraction. The existing tag-service entry reexports it.
`fileCandidates`, QmdEngine and tag search actions reuse these functions; there
is no second index, watcher, body cache or server request on picker keystrokes.

| Input | Meaning in both file and body search |
| --- | --- |
| `量子` / `liangzi` / `lz` | Normal text/name matching using existing pinyin settings. The file picker searches catalog names/aliases and optionally paths; body search retains its full-text engine. |
| `#化学` | Require 化学 or a descendant such as 化学/物理. Match is exact by hierarchy segment, normalized and case-insensitive; it is not a fuzzy tag substring. |
| `量子 #化学` | Normal text plus the tag requirement. Separate query terms with spaces. |
| `#化学 #笔记` | Both tag requirements must match. |
| `#化学 -#旧版` | Require 化学, exclude 旧版 and its descendants. |
| `tag:#化学`, `tags:化学`, `-tag:#旧版` | Existing aliases remain accepted. New menu-generated queries use the short hash form. |
| `"#literal"` | A quoted token remains ordinary text instead of becoming a tag operator. Quoting does not add a new exact-phrase engine. |

`title:`, `path:`, `heading:` and `body:` share field extraction. They retain the
existing whole-query field scope (multiple field names select their union),
not per-clause Boolean logic. The picker uses only its catalog; `body:` directs
the user to the full search panel instead of downloading note bodies. Bare `#`,
malformed tags, and a hash inside a word are literal text. AND between required
tags and exclusion are supported; OR, parentheses and regex syntax are not
newly promised. The old optional tagFilter preference is ignored: operator
meaning must not differ between two search entry points.

## File names and existing data

New file names and file renames cannot introduce `#` in the leaf name. The
shared error text is enforced in server Vault text/buffer creation, rename and
single-file copy, including API/plugin/UI callers. Existing hash-named files
from an external editor remain readable, editable and movable without changing
their leaf; they are never bulk renamed. Existing hash-bearing parent folders
remain usable. This filename rule does not rewrite Markdown heading markers,
frontmatter values, aliases, link fragments or tags in note content.

## Validation

The user's latest instruction stops all tests, type/build checks and runtime/UI
acceptance. Only source/diff inspection follows that correction. The cases below
were authored/run earlier; they are historical evidence, not acceptance of the
later sidebar-picking integration or current parallel changes. No 0.1.9 EXE has
been built or accepted.

The parser regression covers multiple tags, excluded descendants, legacy forms,
quoted hashes, unknown operators and leaf-name validation. Browser coverage
checks real picker filtering/pinyin/scopes, command shortcuts/selection scrolling,
plain-name creation versus filter expressions, light/dark screenshots and a
390px viewport. Packaged-startup acceptance also queries the production search
API with both syntaxes, rejects hash names via create/rename/copy, and confirms
an existing hash-named note can still save. All fixtures use disposable data.
