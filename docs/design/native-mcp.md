# Native operation and review integration

## Scope and existing owners

The native application is local-only (see personal-local-runtime.md). This change
does not restore accounts, JWT, API keys, public shares, a model client, or a
Tunnel. The reference obsidian-context-mcp checkout is read-only provenance;
its plugin deployments and connection profiles remain independent.

The first native contract contains six tools: context, saved file list, native
search, ranged read, propose, and status. Proposals contain exactly one edit of
one existing Markdown file. Create/move/trash and multi-file groups fail schema
validation. These are explicit unsupported operations, not silently partial work.

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
its scheduling because it does not use that writer. Rename/trash/etc. keep their existing route
semantics; those operations are not part of this first MCP contract.

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
2. The UI inbox (bottom-right badge or command `审阅候选修改`) lets the user select a
   proposal without unsolicited navigation. Existing note text is red-tinted;
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
The sixth fixed right ribbon panel shows pending context and native review
candidates. Socket mutation notifications update other windows without polling.
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
HTTP/browser tests. Manual recovery delegates scripts/start-mcp.ps1 to the
existing obsidian-context-mcp launcher, preserving its host-local identity.

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

### Desktop manual Tunnel controls

Windows desktop exposes Start, Restart and Status in the right MCP panel. The
main process calls the companion project's existing `scripts/manual-start-mcp.ps1`;
it does not implement another Tunnel runtime or expose process execution over
HTTP/MCP. Actions are allowlisted, single-flight, bounded to 60 seconds/32 KiB,
and require the local application's top-level frame through `desktopWindow`.
No command runs on panel mount; inspection only checks local files. Web/mobile
and non-Windows desktop do not display unsupported launch controls.

The default project is `~/Project/Workspaces/obsidian-context-mcp`. Users may
select another trusted project directory through the native picker. Its package
name and manual entry are validated before persisting `mcpProjectPath` in the
existing host-local desktop config; no Vault configuration, shortcut, login task,
Tunnel alias/identity or credentials are rewritten. The current instance's endpoint
file is passed explicitly for the script's health preflight. The companion still
owns its configured stdio target; selecting a different instance does not retarget
that configuration. External Node and an already configured companion installation
are required. Restart is explicit; Start does not disconnect an existing runtime.
The UI reports command completion and retains bounded output, not remote ChatGPT
end-to-end health. There is no watchdog or background status polling.

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
configuration is installed or rewritten. Compiled entries are server/dist/cli.js
and server/dist/mcp.js. Do not launch the HTTP server by importing the MCP entry.

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
or existing profile. No runtime process is launched by this implementation pass.

Independent coordinator regression list: CLI/MCP tool discovery and result/error
agreement; no accept tool; unsupported operations; propose causes no disk write;
idempotent retries; three separated hunks with partial accept/reject; same-line
and unrelated-line edits; fresh Ctrl+Z/history; BOM+mixed CRLF/LF/CR range roundtrip;
readonly candidate JS and nested embed execution denial; stale/multiple/closed
workspaces; fixed-tag changes; failed/lost write acknowledgments and restart
recovery; Vault switch; local-access rejection; search uses the existing index.
