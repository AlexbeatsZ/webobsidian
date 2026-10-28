# Feedback DOCX Implementation & Verification Report (2026-10-28)

## Scope
Address the two new user feedback items in `C:\Users\Meta\Desktop\obsidian使用反馈.docx`:
- **F03 (`P3`)**: Manual MCP startup/recovery script + MCP context queue (`右键菜单` + `Mod+Shift+M` hotkey + Right Sidebar `MCP` panel with one-shot delivery, pin/unpin, manual removal, and extensible sections).
- **F04 (`P4`)**: Replace `mermaid` with `@obsidianmd/pele` (`pele@^1.12.0`) and remove the legacy `mermaid` dependency.

## Implementation Summary
1. **F03 — Manual MCP Startup & Recovery Scripts**:
   - Added `scripts/start-mcp.ps1` and companion `C:\Users\Meta\Project\Workspaces\obsidian-context-mcp\scripts\manual-start-mcp.ps1` supporting `-Action Status | Start | Restart | EnsureTask | Tunnel`.
   - Fixed `obsidian-context-mcp/scripts/tunnel-startup.ps1` `-Mode Run` to auto-detect `node.exe` when `-NodePath` is omitted, and added `restart` support to `obsidian-context-mcp/scripts/tunnel.mjs`.
2. **F03 — MCP Context Queue, Right-Click Menu, Hotkey & Right Sidebar Panel**:
   - Added `server/src/services/mcpContext.ts` and `/api/operations/context` endpoints (`GET`, `POST`, `PATCH /:id`, `DELETE /:id`) with Vault-scoped in-memory queue (`MAX_ITEMS = 50`, `MAX_SELECTIONS = 20`, `MAX_SELECTION_CHARS = 8000`, `MAX_TOTAL_CHARS = 32000`), path validation, and WebSocket `mcp-context-changed` broadcast.
   - Updated `obsidian_get_context` in `server/src/services/operations.ts` and `server/src/operations/contract.ts`: returns `queued_context`, suppresses default full-note `nearby_text` when explicit context is queued, and atomically consumes unpinned items upon successful delivery while retaining pinned items.
   - Extended `web/src/lib/review/client.ts`, `web/src/components/MarkdownView.tsx`, `web/src/lib/nativeWorkspaceCommands.ts`, and `web/src/components/RightSidebar.tsx`:
     - Editor selection (`live`/`source`): captures both selected text and 1-based `{ line, ch }` source coordinates + `revision` (`kind: 'source'`).
     - Reading mode selection: captures selected text (`kind: 'rendered'`).
     - Unselected hotkey (`Mod+Shift+M`) or context menu (`添加当前页面到 MCP 上下文`): queues focused note path only (`kind: 'page'`, without note content).
     - Right Sidebar `MCP` fixed ribbon tab & panel (`上下文` and `候选修改` sections) with click-to-navigate, pin/unpin (`固定保留`/`取消固定`), and manual removal (`移除上下文`).
3. **F04 — Pele Diagram Renderer Migration**:
   - Removed `mermaid` (`^11.15.0`) and installed `pele` (`^1.12.0`) in `web/package.json`.
   - Added `web/src/lib/diagrams.ts` wrapping `pele.render` with font readiness waiting, external links/images disabled (`links: false, images: false`), and `AbortSignal` cancellation.
   - Updated `MermaidWidget` in `web/src/lib/livePreview.ts`, `loadMermaid` compatibility adapter in `web/src/lib/obsidian/runtime.ts`, and `.cm-mermaid` `--pele-*` theme CSS variables in `web/src/styles/obsidian.css`.

## Verification Results
- **Typechecks**:
  - `npm run typecheck` (`search-core`, `markdown-core`, `server`, `web`): **PASS (0 errors)**
  - `npm --workspace desktop run typecheck`: **PASS (0 errors)**
- **Unit Tests**:
  - `npm run test:unit`: **75/75 files, 420/420 tests PASS (5.55s)**
    - Includes `server/src/services/mcpContext.test.ts` (**8/8 PASS**) and `web/src/lib/diagrams.test.ts` (**6/6 PASS**).
- **Production Build**:
  - `npm run build` (`search-core`, `markdown-core`, `web`, `server`): **PASS** (separate `pele` chunk emitted cleanly, zero `mermaid` bundle inputs).
- **Focused Browser Tests (Playwright + Edge)**:
  - `tests/browser/theme-render.spec.ts`: **7/7 PASS**
  - `tests/browser/async-media-transition.spec.ts`: **18/18 PASS**
  - `tests/browser/sidebar.spec.ts`: **4/4 PASS**
  - `tests/browser/architecture-render.spec.ts`: **17/17 PASS**
  - `tests/browser/mcp-context.spec.ts`: **2/2 PASS**
  - Total focused browser tests: **48/48 PASS, 0 console/page errors**.
- **Manual MCP Script Smoke**:
  - `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-mcp.ps1 -Action Status`: **exit 0** (`obsidian-context-stem-win ready`).
- **Feedback DOCX Update**:
  - Backed up original `C:\Users\Meta\Desktop\obsidian使用反馈.docx` (`34863` bytes) to `C:\Users\Meta\AppData\Local\Temp\.agents\obsidian-feedback-20261028\obsidian使用反馈-before.docx`.
  - Added `[F03]` (`w:id="2"` on `w14:paraId="469E36F6"`) and `[F04]` (`w:id="3"` on `w14:paraId="4059D13B"`), preserving original body text, `word/media/image1.png` (`15520` bytes), and `[F01]`/`[F02]`.

## Boundaries
- No new desktop/mobile installer package was built or installed in this task; installed `0.1.28` predates these source changes.
- Live Vault (`C:\Users\Meta\Documents\Obsidian\STEM`) and user profiles were untouched.
