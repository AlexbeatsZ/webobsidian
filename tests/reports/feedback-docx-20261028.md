# Feedback DOCX review and delivery 2026-10-28

## Scope and provenance

Desktop obsidian使用反馈.docx adds F03 (manual MCP recovery and explicit context)
and F04 (Pele replacing Mermaid). F01/F02 are previous deliveries. Gemini's
Reading And Fixing Obsidian Feedback transcript and source changes were reviewed,
not accepted from its summary alone. Concurrent edits/builds ended before final
independent runs. The original root public entry was rebuilt by Gemini; final
delivery builds use temporary isolated output only.

## Implementation and review corrections

- scripts/start-mcp.ps1 delegates to the sibling MCP manual-start-mcp.ps1.
  Actions are Start(default), Restart, Stop and Status only, not EnsureTask/Tunnel.
  Configured loopback native endpoint is checked before start/restart; unavailable
  applications do not disconnect an existing Tunnel. No new service, login task,
  automatic retry or global installation. Standard stdio PS wrapper now uses the
  existing launcher; both PS entries are included in the distribution allowlist.
- Existing operation workspace capture validates source selections against
  DocumentSession/SourceDocument. Text, raw revision, 1-based lines and 0-based
  UTF-16 columns are retained. Reading selections are rendered text without
  invented source positions. Fragment-local coordinates are rejected; oversized
  selections fail explicitly rather than silently truncating.
- Queue persists atomically under DATA_DIR/mcp-context, scoped by Vault, bounded
  to 50 items, 20 selections per item, 16384 characters per selection and 512 Ki
  characters of serialized data. It is not in-memory-only and does not use the
  obsolete 8000/32000 limits stated in Gemini's original report.
- Mod+Shift+M, editor context menu and right MCP panel share one capture/mutation
  owner. No selection queues a path only, without body/nearby_text. Pin/remove
  and socket notifications reuse existing lifecycles, without per-keystroke IO.
- obsidian_get_context delivers queued entries first. Local HTTP response finish
  consumes only delivered, still-unpinned IDs. New/pinned items survive; reads
  serialize. Failed/aborted reads retain context; persistence failures are logged
  without a second response. Connection/discovery alone do not drain the queue.
  This is local transport handoff, not proof of remote model receipt. Server
  instructions request get_context per user request.
- Selection links reuse native range/text navigation with exact columns/end,
  including duplicate text. Review candidates share the panel; real errors show.
- Pele 1.12 replaces old Mermaid runtime/dependency. Existing mermaid fence syntax,
  widgets, source controls, Undo and latest-success presentation remain. Native
  widgets and loadMermaid's render adapter share diagrams.ts. Hidden stages and
  old initialization/fallback are removed. Document fonts/theme and RenderLifetime
  are reused; external links/images disabled. No full Mermaid API/grammar parity
  is promised.

## Independent acceptance

- 75 unit files, 420/420 tests pass (5.58s); Web/Server/Desktop types pass.
  Web lib ES2023 matches existing findLast use; target remains ES2022.
- 49 distinct focused browser tests pass: architecture17, async-media18, theme7,
  MCP3, workspace-sidebar4. A real disposable backend covers BOM/CRLF/UTF-16,
  duplicate text navigation, pin/unpin, one-shot delivery, path-only payload,
  remove/reload, reading selection after panel focus and unchanged fixture bytes.
- Browser fixture no longer turns arbitrary API failures into HTTP200. It closes
  its page before its backend and ignores only aborted/closed-page requests.
  Earlier mixed-generation BaseNode startup, stale assertions, socket interception
  and teardown failures are not final evidence. Wrong integration selector found
  no tests; correct workspace project then passed all4. No tolerance weakened.
- Companion MCP: 60/60 Windows tests, build/package and extracted stdio smoke pass.
  Fake-runtime test checks offline endpoint does not restart; Stop remains
  available; healthy Start/Status/Restart delegate without changing the launcher.
  ZIP explicitly checks all three stdio/manual entrypoints exist.
- Live read-only Status: original Tunnel ready, configured native application
  endpoint unavailable, correctly exit1. Nothing restarted. Original intermittent
  startup/exit cause remains unconfirmed.

## Delivery boundary

Windows0.1.29 and companion MCP0.2.1 are prepared for exact-source publication.
Installer/production-smoke/remote asset results must be recorded after completion.
Installed0.1.28 is not upgraded here. No live Vault migration/write, physicalIME,
nativeElectronUI, remoteChatGPT, other-platform installer or long-run acceptance.

Gemini backed up the DOCX and added F03/F04 comments. Its inaccurate parameters,
limits and column wording require corrected anchored comments while preserving
original prose/images/F01/F02.
