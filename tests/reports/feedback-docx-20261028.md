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

## Delivery and remaining boundaries

- Published AlexbeatsZ/webobsidian v0.1.29, non-draft/non-prerelease, exact product
  source b3b3fd6. Windows x64 NSIS is105608457bytes, PE0.1.29; blockmap110117bytes
  and BUILD-INFO.json1009bytes uploaded and remote asset states/sizes verified.
- Exact git archive isolated production/core/server/desktop build, standalone
  bundle guard and NSIS pass. Initial fixture omitted workspace dependency
  junctions, then supplied a split PowerShell electronDist argument; both build
  harness issues were corrected without product changes. Existing chunk-size
  and static/dynamic-import warnings remain, not build failures. Root public
  size/UTCmtime unchanged during this final isolated build, unlike Gemini's
  earlier root build. No code-signing certificate configured.
- Actual win-unpacked resources pass production SPA+server smoke twice. Extended
  production check proves Pele SVG, keyboard path-only MCP entry, pin retention,
  unpin/one-shot removal, local saved edits and existing native features in5193ms,
  renderer errors0. The regression harness was extended after the product build;
  no application source changed. Screenshot inspected. Evidence copied to
  .local/feedback-review-20261028/feedback-production-smoke and build.log.
- Published companion MCP v0.2.1 from7cfe2c3 with both ZIPs, plugin assets and
  notices. Uploaded states/sizes verified; all three platform CI jobs succeeded
  in run40797479213. No new live plugin install or Tunnel restart.
- Corrected existing F03/F04 Word comments only, with fresh reread/backup and
  stale-write guard. Every other DOCX ZIP part (including body/media) is byte
  identical and F01/F02 comment elements unchanged. Backup:
  Temp/.agents/obsidian-feedback-review-20261028/before-review.docx.
  DOCX rasterization attempted but unavailable: bundled renderer found no
  LibreOffice soffice.exe. No visual-layout acceptance or global installation.
- Cleanup of old local desktop release0.1.22-0.1.28/MCP ZIPs was rejected before
  execution by environment policy. Independent cleanup of this task's exact
  Temp/.agents/webobsidian-release-0129-98ea01d4 source/archive/build was also
  rejected. Neither was retried via another deletion mechanism; old artifacts
  and temporary source still remain. No claim of completed cleanup.
- Installed0.1.28 is not upgraded. No live Vault migration/write, physicalIME,
  nativeElectronUI, remoteChatGPT, other-platform installer or long-run acceptance.
