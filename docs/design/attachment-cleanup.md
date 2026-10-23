# Native unused attachment cleanup

## Goal and ownership

The native command `attachments:cleanup` opens a scan/preview dialog for unused
attachments. It shows paths, count and bytes, preserves user directory/type
exclusions, supports individual selection/all selection, then requires a separate
confirmation before moving files through the existing Vault trash service.
It never calls permanent removal, even if the normal file deletion mode is
`permanent`. Existing Trash UI and restore endpoints own recovery.
Scanning is read-only. Exclusion persistence has a separate explicit save button;
the scan action never writes settings or Vault files. Opening the dialog reads
current Vault-specific exclusions before enabling scan, so asynchronous startup
does not replace an existing user's exclusions with defaults.

This is an on-demand maintenance operation. `VaultCatalog` remains the only saved
membership owner; `catalog.resolve(target, source, 'allFiles')` and its existing
`TargetIndex` own resolution. Markdown-only link graph semantics are unchanged.
There is no new disk watcher, search index, persistent body mirror, path resolver,
command registry or editor-session registry. No scan runs on menu opens/typing.

The implementation is isolated in:

- `server/src/services/attachment-cleanup/{types,references,pluginReaders,service}.ts`.
- `server/src/routes/attachments.ts`, factory `createAttachmentsRouter(service)`.
- `web/src/lib/attachments/{types,commands}.ts`.
- `web/src/components/AttachmentCleanupDialog.{tsx,css}`.

Shared startup/settings/command/plugin-loader/session/maintenance-lease wiring is
owned by the coordinating chat. Its exact integration contract and progress are
in `.local/feature-integration/attachments/integration.md`. Until the real
maintenance lease and authoritative workspace checks are connected, execution
must remain unavailable. An empty/fake safety adapter is not a supported mode.

## Legacy implementation and migration

Read-only source baseline: local Obsidian Plus 1.3.1,
`src/unused-images/core.ts`, `src/unused-images/module.ts` and its `AGENTS.md`.
Its focused unused-image module has a fixed image extension list, resolved-link
cache plus text/frontmatter/Canvas fallbacks, `.trash` only, sequential moves and
whole-run abort on discovery failure. It does not provide preview, candidate
revision validation or a configurable exclusion policy. The native feature
retains its conservative discovery principle, broadens beyond images and adds
the preview/lease/revalidation boundary.

The coordinator suppresses `oz-clear-unused-images` and only the `unusedImages`
module in Obsidian Plus. Other Plus modules remain active as appropriate. Map
`oz-clear-unused-images:clear-unused-images` and
`obsidian-plus:clear-unused-images` to the new native command. Existing plugin
files/settings are preserved, including explicitly configured exclusions; native
options are merged/persisted by the existing settings service, not written into
the legacy plugin directory. No default shortcut is reserved.

## Candidate and reference coverage

Candidate leaf types are an explicit allowlist: images, audio/video, PDF/office
documents, archives and fonts. SVG is both a potential attachment and a reference
source. Markdown/Markdown aliases, Canvas, JSON/YAML/Base, HTML/CSS and plain text
are reference sources and protected documents/configuration. TeX/STY/CLS/Bib
files are also protected sources, with literal TeX media collection. Unknown
extensions are protected non-candidates with an explicit coverage notice; their
presence alone is not evidence that every attachment has a hidden dependency.
The catalog's existing ignored Git/dependency directories and configured trash
are outside cleanup. Symlinks and unindexed visible files block cleanup. Unknown
private hidden data is protected/reported rather than inferred to be an attachment.

Directory exclusions are exact Vault-relative directory prefixes, extensions
are normalized case-insensitively. Exclusions affect candidates only: documents
in excluded directories still participate in reference discovery. There is no
"ignore discovery errors" or "force delete" option.

| Reference source | Handling |
| --- | --- |
| Markdown wiki links/embeds | Shared source analysis plus conservative raw positive-evidence scan; aliases, heading fragments, escaped punctuation and percent encoding are normalized before the shared resolver. |
| Markdown ordinary links/images | Shared Lezer URL nodes include balanced/escaped destinations and reference definitions. Shared metadata and raw syntax evidence add conservative protection. |
| Relative ordinary URLs | Protect the union of shared normal resolution and explicit `./` source-relative resolution. Absolute Vault paths retain shared behavior. |
| Duplicate basenames | An ambiguous shared result protects every returned candidate; there is no first-result deletion decision. |
| Frontmatter/YAML | Shared `parseYamlSource`, bounded YAML alias expansion, recursively collect keys/string values and embedded link syntax; malformed/unknown-tag data blocks execution. No source is serialized or modified. |
| HTML | Quoted/unquoted `src`, `href`, `poster`, object `data`, `xlink:href`, `data-src`, `data-href`, quoted `srcset`; shared entity decoding. Complex/unquoted srcset blocks execution. |
| CSS | `url(...)`, quoted `@import`, quoted and ordinary escaped punctuation; unsupported hex escapes, continuation, image-set or malformed URL expressions block execution. |
| Canvas | Strict JSON root with nodes/edges arrays; standard text/file/link/group nodes. File nodes, text-node Markdown and nested strings participate. Unknown/malformed nodes block execution. |
| Core `.obsidian` config | Explicit on-demand read because the catalog omits hidden config. JSON/YAML/CSS/text strings contribute positive evidence. Unknown opaque config formats are protected/reported; parse/read failures in supported formats block execution. |
| Plugin resources | All plugin files are protected. Standard `main.js` and `manifest.json` are implementation assets, not candidates; `styles.css` contributes CSS references. Plugin presence alone does not forbid cleanup. |
| Plugin data | Protect every plugin file; collect explicit text/JSON evidence. Built-in schema readers cover ten current configurations. Unknown/opaque data is protected/reported without inventing dependencies on all candidates. Actual unbounded dynamic expressions still block execution. Optional host readers supplement supported formats. |
| Dynamic resource targets | A target with a fixed suffix protects all candidates of that extension. An unbounded target blocks execution. TeX image macros/search directories protect image/PDF extensions. |
| Scripts/dynamic queries | Local custom URL protocols, HTML scripts/base/events, known Dataview/Templater/query fences, Base query files and unsupported expressions block execution. |

False positives are intentional: a link appearing in examples, comments, code or
an unreferenced reference definition can protect an attachment. Broken ordinary
targets are reported; they do not turn an ambiguous target into an unused file.
Percent-decoding failures and denied local targets block execution. A reference
reader must not catch a parse/read error and return an empty set.

This coverage does not promise arbitrary opaque-format/plugin-code dependency
analysis. Unknown files remain protected and the preview states that their private
internal dependencies were not parsed. Unknown-file presence alone does not create
a whole-Vault ban. An observed dynamic resource expression with no bounded target
scope does block cleanup until that expression is supported. There is no option to
ignore such a discovered error or bypass it.

Built-in readers cover the actual configuration shapes for `any-block`,
`fuzzy-chinese-pinyin`, `local-latex-renderer`, `obsidian-latex`,
`obsidian-latex-suite`, `obsidian-linter`, `obsidian-menu-manager`, `obsidian-plus`,
`templater-obsidian` and `webviewer-userscripts`. They validate the known top-level
shape, parse JSON strictly and collect literal configuration/generated-text
references. They do not evaluate replacement scripts. Webviewer script source is
isolated-guest code, not Vault Markdown; metadata and storage still contribute
literal evidence. The copied LaTeX Suite data is from 1.9.8, while the native
implementation migration targets 1.14.0; the supported data shape is explicit.

## Scan consistency and memory

The scan captures the Vault root, catalog object identity and host mutation epoch.
It checks current membership against existing catalog directories, scans hidden
configuration separately, and reads sources sequentially. This is a temporary
consistency snapshot of the existing catalog, not another persistent Vault index.
Each source is capped at 16 MiB; oversized/unreadable/non-lossless UTF-8 sources
block execution. Parsing keeps only the current source body. Preview tickets
retain paths, directory member names, stat stamps and concurrency tokens, never
a full Vault body mirror.

Candidate bytes are streamed to compute a binary concurrency revision together
with device/inode/size/mtime/ctime. This is needed because binary attachments have
no `textFile` revision. It is a change token, not an integrity audit. Source reads
reuse `readFileSnapshot` and its existing lossless UTF-8/revision handling. Stat
stamps before and after reads and a final directory/source check detect mutation
during discovery. Any state/root/catalog change makes the preview non-executable.

All work is explicit and sequential rather than an unbounded `Promise.all` over
the Vault. Large scans and repeated conservative pre-move stat checks can take
time; no performance measurement or background maintenance claim is made.

## Unsaved state, execution and failure semantics

Client safety must include all existing DocumentRegistry sessions, unsaved Canvas
buffers, conflicts and pending requests/writes, not just the active file. The UI
blocks scan/execute while local blockers exist and invalidates the preview when
that safety state changes. A server-side maintenance lease then drains in-flight
mutations, freezes connected clients and checks authoritative clean acknowledgments.
Unknown/unsafe clients block execution; an execute-body boolean cannot replace
this check. Root/index/config changes and external watcher events must feed the
host's epoch/lease guard.

1. Preview has a random session-bound token, 10-minute expiry, at most eight
   retained sessions, and only one current preview per session.
2. Execution consumes the token once, validates selected paths against the
   server-retained candidate set, acquires the host lease and rechecks root,
   catalog identity, epoch and all workspace blockers.
3. A fresh complete source scan repeats reference discovery. Every selected
   attachment must still be a candidate with the original stat/content revision.
   Failure before this point moves nothing.
4. Before each move, recheck workspace lease safety, root/catalog/trash config,
   directory membership and source stamps, then stream the candidate revision.
   Validate the destination through the existing realpath guard, then use only
   `vault.trash`, which already feeds the canonical update queue. A trash path
   cannot enter Git metadata or escape the Vault through a symlink.
5. Own trash events can advance the shared epoch. Do not compare the initial
   preview epoch after own moves. Remove only the known moved name from the
   expected parent member set, verify membership, and rebase the affected parent
   and root stat. A newly created nested trash ancestor chain is the only allowed
   new directory structure; any extra member still stops execution. External lease
   violations/root replacement still stop the job.
6. A move or later safety-check failure stops remaining work. Return moved
   source/trash paths, failure details and a stopped message. This is a partial
   operation with recoverable trash contents, not an all-or-nothing filesystem
   transaction. Retry requires a new preview.

Cooperative writers are excluded by the maintenance lease. External tools cannot
be atomically locked across all operating-system files; watcher guards plus
directory/stat/content checks reduce that race and stop observed changes. A write
at the final OS rename boundary cannot be universally excluded by this service.
Keep sync/external editors quiescent during user acceptance of cleanup.

The UI prevents duplicate execute requests and closing during an active execute,
rejects stale async scan responses, traps dialog focus and returns focus on close.
Paths are React text, never HTML. Transport failure does not imply no movement:
the dialog directs the user to inspect Trash/files before retrying.

## HTTP and recovery

The local-only router uses the server-wide local access check, `asyncHandler`, error
middleware and strict zod validation:

- `POST /api/attachments/scan`: `{excludeDirectories, excludeExtensions}`.
- `POST /api/attachments/execute`: `{token, paths, confirm: true}`.

Restore through the existing Trash modal (`setTrash(true)`),
`GET /api/files/trash` and `POST /api/files/trash/restore`. Restore already avoids
overwriting recreated same-name files. The cleanup service adds no permanent
delete, empty-trash or automatic rollback path. It does not rewrite notes.

## Validation boundary

2026-10-22: feature-scoped TypeScript checks with current source aliases pass for
server and web; isolated ESM bundles for router/service/dialog and service syntax
check pass. Outputs are under
`%TEMP%/.agents/attachment-cleanup-static`; no existing runtime assets are replaced.
Regression scenarios are authored as fixtures but not executed.

No unit/HTTP/browser/Electron/server invocation, live Vault edit, actual trash
operation or portable build is authorized in this pass. Shared integration still
needs the coordinator's final whole-application static checks. UI, keyboard
registry wiring, authoritative multi-client freeze, source correctness on a real
Vault and recovery acceptance remain unverified until separately authorized.
