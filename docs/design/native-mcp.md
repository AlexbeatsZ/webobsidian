# Native operation and review integration

## Scope and existing owners

The native application is local-only (see personal-local-runtime.md). This change
does not restore accounts, JWT, API keys, public shares, a model client, or a
Tunnel. The reference obsidian-context-mcp checkout is read-only provenance;
its plugin deployments and connection profiles remain independent.

The native contract contains seven tools: context, saved file list, native
search, ranged read, reference-target lookup, propose, and status. Each proposal contains exactly one
Markdown note operation: edit, create, or rename. File/folder deletion, folder
operations and multiple-operation groups fail schema validation.

Existing owners remain authoritative:

| Capability | Owner and concrete callers |
| --- | --- |
| Syntax, source coordinates, raw-byte preservation | markdown-core SourceDocument; operation edits and DocumentSession |
| Fine text changes, undo, save | changesBetween and DocumentSession; normal editor and local review acceptance |
| Saved files and search | VaultCatalog and QmdEngine; normal UI and operation dispatcher |
| File writes and notifications | vault.writeFileText, textFile queue and fileupdates; UI routes and review-triggered session saves |
| Save-time fixed tags | Existing planFolderTags; initial-file planner, workspace session, reviewed candidate preparation |
| Markdown/MathJax rendering | Existing MarkdownView/mountFragment and RenderContext; ordinary documents and readonly candidates |
| Local access and maintenance | Existing requireLocal, HTTP writer gate and WS; no separate listener/authentication server |

`markdown-core/review.ts` owns only line-hunk materialization, exact rebase and
three-way recovery. Line review units differ intentionally from the finer
character patches used to preserve cursors. The MCP editor-changes implementation
is not copied: local acceptance calls DocumentSession.setRawText, which already
uses changesBetween and SourceDocument. No second parser/index/watcher, shell
executor or keyboard/coordinate implementation is introduced.

`operations/contract.ts` is the shared Zod input/description catalog. The native
HTTP dispatcher validates it; stdio MCP derives its schemas from it; CLI forwards
the same JSON and reports the same results. The dispatcher does not invoke
browser-only command callbacks. `review-changes` is registered in the existing
CommandManager and opens the native review inbox.

Text-write Git scheduling moved from route/tag text-write callers to vault.writeFileText;
the redundant calls were removed. The exclusive raw Tag Page creator retains
its scheduling because it does not use that writer. Reviewed renames reuse
vault.rename and the native workspace path transaction. Rename reserves the
existing physical writer queues for both source and destination in sorted
order and optionally compares the source revision before moving it.

## Read/coordinate contract

Read content, source selections, nearby text and edit positions use the same
SourceDocument text: no initial BOM, LF-normalized CRLF/CR/newlines, 1-based lines
and 0-based UTF-16 columns. `expected_text` must match that normalized text exactly.
`revision` identifies the complete original raw UTF-8 text, including BOM and
original line endings. SourceDocument maps accepted edits back to that raw source;
untouched bytes and mixed endings stay untouched. Replacement line breaks use
the existing SourceDocument insertion policy. A partial long-line read must not
be treated as a complete-file baseline.

The saved catalog and native query syntax replace the old MCP full-body scan.
Search therefore explicitly reports saved-markdown-index scope, including the
existing indexing body limits and native literal/pinyin/query behavior. It does
not promise the old plugin's all-text AND-substring scan. Read uses a connected
dirty document when available; conflicting drafts fail rather than choosing one.
Nontext files return unsupported-content metadata and cannot become proposals.

Context is requested on the existing application socket, never serialized on
every input/selection. It includes the most recently interacted local workspace,
current version/selection, open/recent paths and bounded nearby text. Source-mode
positions are emitted only for a full-note editor matching its DocumentSession.
Reading selections carry text only; embedded cells never fabricate full-note
coordinates. Source selection survives browser blur; explicit clearing is empty.
Clients that have switched Vault, fail to respond or hold divergent drafts block
operations requiring a trustworthy editor snapshot.

## Candidate lifecycle and local application

1. Propose verifies the raw revision and normalized expected text, applies source
   ranges, and prepares fixed folder tags using the existing planner. It persists
   baseline/hunks/idempotency before reporting success. It does not write notes.
2. The proposal list has one place: the MCP sidebar's 候选修改 section. The
   bottom-right badge and the command `审阅候选修改` open that section (the badge
   hides while it is visible); only a selected create/rename file operation opens
   its detail dialog. Selecting does not navigate unsolicited. Existing note text is red-tinted;
   proposed additions are green readonly widgets with per-hunk Accept/Reject and
   a source/preview toggle. The toolbar also accepts/rejects remaining hunks and
   offers explicit recovery. Finished records stay available for recovery.
   The toolbar is itself a native CM block in the existing centered document
   column, so it shares the document width/scroll and does not begin behind the
   floating sidebars. All review buttons reuse the application btn styles/tokens.
3. Candidates mount the existing Markdown renderer with nonExecutingContext,
   scripts/plugins/HTML execution disabled recursively, and block effects disabled.
   Candidate bytes never enter the actual document before acceptance.
4. Acceptance captures all connected workspaces, checks the target and other dirty
   owners, performs exact line rebase, and persists an intended-write record before
   asking the selected local workspace to apply. Same-line edits and coincident
   insertion points conflict. Unrelated edits may move pending hunks safely.
5. The client rechecks version/raw/disk revision after loading current preferences,
   applies one existing session transaction and awaits exact-content save. It does
   not use manual-save formatting, which could add unreviewed changes. The native
   session rejects a save whose automatic tags or intervening edits change the
   reviewed bytes. Dirty drafts survive failures; no fake rollback is reported.
6. The server checks actual disk bytes before recording the decision. Lost replies
   and restarts reconcile an intended write only against its exact before/after
   image. A matching unsaved post-accept draft leaves the record uncertain until
   saved or undone. Ambiguous disk states stop further decisions.
7. Recovery merges accepted after-images/current/preimages in reverse order. It
   keeps later unrelated edits and blocks on changes to accepted lines. Recovery
   also goes through the same local session/save path. It does not replace Ctrl+Z
   or the Git history module.

Proposal decisions are serialized by the one review lifecycle. Actual disk text
writes continue to use the existing per-path writer queue. A multi-process
filesystem transaction against arbitrary external editors is not promised.
Proposal records and preimages live outside the Vault at
`DATA_DIR/review/<vault-root-digest>`. Up to 200 retained records per Vault are
admitted; capacity fails explicitly rather than discarding pending/recovery data.
Archive old terminal records manually with the application stopped if needed.

HTTP `GET /api/operations/reviews` and `GET /reviews/:id` are native UI data.
`POST /reviews/:id/decide` requires a currently connected workspace ID and an
on-socket exact application acknowledgment. This is the local UI capability,
not an MCP tool. The local-only application trusts local software; this is not
an additional sandbox against a malicious process already able to call its
normal local file endpoints. There is no accept/restore operation in the machine
tool catalog.

## Reference targets and typed IDs (2026-11-05)

Goal: an AI writing notes can cite formulas and other typed targets by their real
`^id` (see content-references.md). IDs may be semantic; the user prefers names
such as `^eq-mass-energy` over generated tokens, so no ID generator is exposed
and the instructions encourage short semantic names.

- `obsidian_find_targets` reuses `VaultCatalog.suggestContentTargets` (the same
  index as the `[[^` suggester), with an optional kind filter applied before the
  limit. Numbered equations carry their TeX as `ContentTarget.detail` (trimmed to
  240 characters) so a formula can be found by content; this changed the persisted
  catalog schema (version 5, full rebuild on first start). `id` mode reports
  `catalog.resolve` status: `missing` means free to define.
- `checkContentIds` runs on edit and create proposals after save preparation.
  It rejects issues that `contentTargets` reports for the candidate but not for the
  baseline (duplicates in the note, typed anchors not attached to a structure,
  invalid ranges) and new target IDs already defined in another saved note.
  Problems already in the baseline and IDs the note already owns never block an
  unrelated edit. New `[[^id]]` references that resolve neither in the candidate
  nor elsewhere are returned as `warnings` on the propose result only (forward
  references stay possible). Unsaved drafts of other notes are not indexed.
- Moving a formula with its ID into a new note is rejected while the old note still
  defines it; remove it there first, or use rename.

## New and renamed notes (2026-11-01)

`obsidian_propose_changes.operations` accepts one discriminated operation:

```json
{"kind":"create","path":"课程/新笔记.md","content":"# 新笔记\n"}
```

```json
{"kind":"rename","path":"课程/旧笔记.md","to":"课程/新名称.md","base_revision":"<fresh read revision>"}
```

Both paths must be visible Vault-relative Markdown file paths. Creation can
make parent folders through the existing exclusive writer; it never overwrites
an existing file or directory. Rename requires a saved source and fresh read
revision, keeps the exact raw bytes, and supports case-only filename changes.
It has the same link-update semantics as the native file-tree rename.

File proposals use the existing persisted inbox/idempotency/serialized decisions.
`fileOperation` is absent on older text proposals, preserving their existing
per-hunk behavior. The local review dialog shows complete create content as
literal source, or the old/new paths for rename. The user accepts/rejects the
whole operation. Selecting a create candidate does not open a missing note.
No remote accept tool, folder operations or deletion is exposed.

Acceptance requires an attached local workspace. It rechecks target absence,
source revision, all responding workspace drafts/conflicts and Vault identity.
The chosen workspace calls store.createNote (with new-note templates disabled)
or store.renamePath; the existing DocumentRegistry path transaction locks
edits and remaps sessions/tabs. Its optional revision guard runs before any
save and after locking. The source/destination writer queues and revision
check in vault.rename protect against competing native saves/creates.
Normal native callers retain their existing template/save behavior.

Creation previews already include automatic folder tags. If the save rules
change before acceptance, the user must resubmit the candidate. Rename does
not run save-time formatting or folder-tag transformation on the moved bytes.

An intended file operation is persisted before the workspace request. The
server confirms the exact destination bytes and source absence after rename,
including actual filename spelling for a Windows case-only rename. Lost
acknowledgements/restarts reconcile only exact before/after states; ambiguous
states retain the record as recovery_required and block further decisions.
File operations are whole actions, with no text-hunk restore command. Normal
native file operations remain available for subsequent user changes.

Status includes `kind`, rename `to`, and `operation.status` with pending,
accepted or rejected. Accepted empty notes still count as one applied step.
Single-file text edits retain the existing `hunks` and recovery semantics.

## Explicit MCP context (2026-10-28)

The native command `mcp:add-context` (default Mod+Shift+M), editor context menu,
and MCP panel add button share one capture owner in review/client. Full-note
source selections carry exact normalized line/UTF-16-column ranges, selected
text and raw revision; reading selections are explicitly rendered text without
invented source coordinates. Fragment-local editors cannot pretend to provide
whole-note ranges. Oversized selections fail instead of silently truncating.
With no selection, only the focused page path is enqueued, never its body.

`DATA_DIR/mcp-context/<vault-root-digest>.json` holds at most 50 items and 512 Ki
characters of serialized context. Local context routes add, remove and pin;
they are not exposed as remote mutation tools. Workspace capture and the
existing DocumentSession/SourceDocument preflight validate source selection.
The MCP right ribbon panel is organized by the user's task: 上下文 first (its
add button sits in that section's header, not the panel title), then 候选修改,
then a 连接 section. 连接 shows its state in the header and is folded once
connected; not connected or failed keeps it open with the output, error and
settings in view. Removing a context item uses the list-removal x, not trash. Socket mutation notifications update other windows without polling.
Selection links use the existing navigation range/text fallback, not a second
coordinate/history pipeline; ambiguous changed text does not jump speculatively.

`obsidian_get_context` delivers queued items before its normal active-page
fallback. Explicit path-only context does not include nearby text. Successful
HTTP response completion consumes exactly the captured, still-unpinned IDs.
Failed/aborted reads, initialization, discovery and tool listing do not drain
the queue; items added during delivery and pinned items survive. Context reads
are serialized so two callers cannot consume the same one-shot snapshot.
Persistence failures retain context and are logged, not answered twice.

MCP server instructions tell clients to call get_context at each user request.
Connecting alone cannot force a model to read it: transport completion is not
proof of remote model receipt. No remote ChatGPT acceptance is claimed by local
HTTP/browser tests. Desktop connection is owned by the application as described
below; it has no companion checkout, script, plugin or external Node dependency.

## Editing performance

Selection-only changes return the same review decoration state. Text changes map
existing hunks through the existing CM ChangeSet; only changed candidate ranges
are compared to their captured text. Same-line changes hide that block; undoing
them can revive it. Full line diff runs when loading/reloading a proposal or doing
explicit write preflight, not on every keystroke. Candidate widget equality retains
unchanged mounted rendering. Closed inboxes do no catalog/body scan. Server list
and search reuse existing saved state; no background polling is added.

These reduce duplicated work; measured latency and runtime correctness belong
to the independent acceptance run, not compilation evidence.

## CLI/MCP and isolated acceptance entrypoints

### Built-in desktop MCP (2026-10-31)

The application ships its own MCP entry and the pinned official OpenAI
`tunnel-client` 0.0.19 with redistribution notices. Build-time downloads verify
the release archive checksum; runtime never downloads software or searches for
a source checkout, PowerShell script, system Node or plugin. The old project
picker, `mcpProjectPath` reader, external launcher and `scripts/start-mcp.ps1`
are removed. Old desktop-config fields may remain inert to preserve user bytes.

`operations/mcpServer.ts` creates the one MCP tool catalog from
`operationContract`. Both bundled `server/dist/mcp.cjs` (stdio) and `/mcp`
(stateless Streamable HTTP on the existing loopback server) call the same
operation HTTP dispatcher. HTTP binds to the actual listening instance, even
when another instance's endpoint environment variable is present. Existing
local-access, operation leases, context persistence, DocumentSession and
local-only review decisions remain authoritative. No second listener, index,
parser, file writer or remote accept tool is introduced.

The root-mounted MCP router explicitly returns JSON 404 for OAuth protected
resource and authorization-server discovery under `/.well-known/`, including
resource-suffixed paths. This local service does not provide OAuth metadata;
these requests must never fall through to the SPA's 200 HTML response, which
causes Tunnel discovery to retry indefinitely and blocks its startup catalog.

All desktop platforms expose **连接**, **复制配置**, and **连接设置**. Copy
provides a stdio client JSON using this WebObsidian executable in
`ELECTRON_RUN_AS_NODE` mode plus its own endpoint file; external Node is not
required. HTTP clients may connect to the instance's `/mcp` URL directly.
Connection settings accept the user's existing Tunnel ID/runtime key without
creating a cloud Tunnel or registering/installing a client plugin.

Desktop main owns one foreground `tunnel-client run` child, bound through HTTP
to this exact application instance. Only an explicit Connect click checks
local health and the owned child's `/readyz`; a healthy child is retained,
otherwise it is stopped before starting once. Readiness waits at most 30
seconds; output retains at most 16 KiB and redacts the key across chunk
boundaries. Failure stops the child and permits manual retry. A failed stop
retains ownership and prevents duplicate startup. No login task, detached
runtime, automatic startup, periodic monitoring or background retry is added.
Normal application quit stops this child after the existing save barrier.

Host-local `userData/mcp/connection.json` stores only the Tunnel ID and an
Electron safeStorage-encrypted key. The key is never returned to the renderer;
empty-key saves retain the existing secret. Unavailable encryption (including
Linux basic_text fallback) fails closed. There is no automatic import from
retired companion credentials, identities or unrelated services.

`desktop:mcp-inspect`, `configure`, `copy-config`, and parameter-free `connect`
all require the local top-level frame through `desktopWindow`. No process or
Tunnel management command is exposed through HTTP/MCP. Component discovery,
successful transport/tool calls, owned Tunnel readiness and actual remote
ChatGPT receipt are separate acceptance levels.

Source development (Node >=20 and project dependencies installed):

```powershell
# CLI: one shared HTTP transport, no MCP child needed
npm run cli -- --url http://127.0.0.1:18787 list
npm run cli -- --url http://127.0.0.1:18787 obsidian_read_file arguments.json

# MCP client launch command: keep stdout exclusively JSON-RPC
node --import tsx server/src/mcp.ts
```

Set `WEBOBSIDIAN_URL=http://127.0.0.1:18787` for the stdio child. Alternatively set
`WEBOBSIDIAN_ENDPOINT_FILE` to the chosen instance's
`DATA_DIR/operations-endpoint.json`; the server writes its actual loopback URL
after listening (including desktop-selected or PORT=0 ports). No real client
configuration is installed or rewritten. Compiled development entries are
server/dist/cli.js and server/dist/mcp.js; desktop additionally packages
standalone server/dist/mcp.cjs. Do not launch the HTTP server by importing the MCP entry.

`POST /api/operations/call` accepts `{name,arguments}`. Example arguments:

```json
{"path":"review.md","start_line":1,"line_count":200}
```

After reading its returned revision, submit:

```json
{
  "request_id":"review-fixture-001",
  "title":"修订段落",
  "operations":[{
    "kind":"edit","path":"review.md","base_revision":"<returned revision>",
    "edits":[{"from":{"line":3,"ch":0},"to":{"line":3,"ch":3},
      "expected_text":"原文字","replacement":"新文字"}]
  }]
}
```

For an isolated test instance use separate absolute `DATA_DIR` and copied
`VAULT_PATH`, `HOST=127.0.0.1`, an unused `PORT`, and no existing settings.json
that could override the fixture path. Open that instance's URL in an isolated
browser/profile. In production bundles the SPA is sibling `server/public` to
`server/dist/index.mjs`. Never point these variables at the live original Vault
or existing profile. Current built-in desktop acceptance is recorded in
`tests/reports/mcp-builtin-20261031.md`.

Independent coordinator regression list: CLI/MCP tool discovery and result/error
agreement; no accept tool; unsupported operations; propose causes no disk write;
idempotent retries; three separated hunks with partial accept/reject; same-line
and unrelated-line edits; fresh Ctrl+Z/history; BOM+mixed CRLF/LF/CR range roundtrip;
readonly candidate JS and nested embed execution denial; stale/multiple/closed
workspaces; fixed-tag changes; failed/lost write acknowledgments and restart
recovery; Vault switch; local-access rejection; search uses the existing index.
