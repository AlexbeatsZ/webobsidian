# Native applications only — 2026-11-01

## Scope and source changes

The owner explicitly retired all Web functionality. Desktop Windows/macOS/Linux
and Android remain the supported application targets. Shared native renderer,
loopback runtime, independent sync server and MCP keep their existing owners.

Deleted Docker deployment/environment files and CI; browser development/preview
and standalone start scripts; browser CORS/proxy; note URL/history routing and
URL/new-window menus; embedded webpage browser; userscript settings, commands,
client, store, updater, guest execution, network and IPC/lifecycle implementation.
WorkspaceLeaf no longer has WebViewer mounting branches. Old WebViewer layout
entries are discarded; original plugin/script/configuration files are preserved.
The existing plugin policy prevents the retired userscript plugin from reloading.

The native shells identify renderer requests through their user-agent facility.
Ordinary browser requests return 404, and note URLs have no SPA fallback. This is
a product boundary, not a new authentication mechanism. Existing Vault/session/
local-access/write-review and shutdown barriers remain the authority.

README, PRD, implementation plan, current design docs, contributor guidance and
local AGENTS now state the native-only rule. Historical release evidence remains
historical. No future Web adaptation is assigned.

## Validation

- Native renderer, server and desktop TypeScript passed.
- 500/500 unit tests across 88 files passed. The first test run exposed an outdated
  shutdown fixture still substituting the removed userscript service. It now uses
  the real MCP shutdown seam; all 10 close/delegation cases pass.
- Old real-App renderer fixtures depended on `/note/...` URL routing. Updated them
  to restore the same native saved workspace at `/`. The first seed omitted tab
  title, which is required by the existing persisted contract; corrected that
  fixture data. No product fallback was reintroduced.
- Inline-title fixture: reload previously relied on URL sync to point at the renamed
  note. It now flushes the native saved workspace before reload, as a native restart
  does; 4/4 file-default cases pass.
- Full renderer suite (installed Edge): 343 passed, 3 failed. elements.spec.ts:78 and
  mcp-context.spec.ts:101 are intermittent (3x rerun: 2/3 and 3/3 pass).
  pdf-toolbar.spec.ts:228 fails identically on the pre-change HEAD 0719551, so it is a
  pre-existing failure, not caused by this removal.
- Isolated working-tree copy: npm ci, root build, desktop build, static bundle check and
  tests/packaged-startup.mjs passed, including 404 for retired note URLs.
- Not run: electron-builder installers, Android build/device, installed-app checks.

## Boundaries

No installed application update/restart, real Vault/profile/configuration edits,
remote sync/Tunnel credential changes or physical IME/touch acceptance. Root
server/public is not a build target. Unrelated MCP/file-default/focus report work
is excluded from this task's staged changes. Version0.1.44 follows fixed0.1.43.
