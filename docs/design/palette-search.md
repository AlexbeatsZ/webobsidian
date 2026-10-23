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
opens in the requested sidebar tab; Canvas and media retain their existing
central view owners rather than being hidden from the picker or forced into a
Markdown tab. Existing attachment-visibility preferences still apply.

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
