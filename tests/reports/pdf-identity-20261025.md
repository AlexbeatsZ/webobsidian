# PDF / binary document identity repair — 2026-10-25

## Conclusion and scope

The PDF path has a reproducible client-side false Vault invalidation. The product has no in-app PDF reader. This patch prevents binary attachments from entering writable DocumentSessions and offers a clearly labelled browser-open/download page. It does not remove identity checks, retry against a new identity, change server configuration, introduce an iframe, or implement PDF.js.

The user's installed Windows 0.1.27 window and live STEM Vault were not operated on. No app restart, note/configuration write, Git staging/commit/push, production build, package, or installation was performed. The patch is in the shared working tree for the parent to integrate. Pre-existing `.workbuddy/` and `tests/reports/windows-install-0127-20261025.md` were preserved.

## Confirmed failure chain

1. `store.openFile` already excludes PDF from its text-session preload, but sets `activePath` normally.
2. `Workspace.EditorPane` has image/audio/video/Canvas branches, then falls through to `Editor` for PDF. There was no PDF iframe in this path; the second-SPA hypothesis is not the cause demonstrated here.
3. `Editor` called `useDocumentSession(path)` unconditionally. That hook calls `DocumentRegistry.open`, then `api.read`.
4. The existing authenticated `/api/files/content` route correctly streams `application/pdf`, rather than a JSON document envelope. The request wrapper returns a string for that content type.
5. `api.read` then compared `file.vault` (undefined on the binary response string) against the captured Vault identity, called `invalidateVaultRequests`, and threw a misleading 409 “文档来自其他 Vault”.
6. The normal subsequent layout save is rejected by the permanent stale-client guard, producing “工作区保存失败，当前布局已保留”. This chain does not require a real Vault switch, migration, socket notification or server restart.

Before the product fix, the new focused client cases gave **4 failures / 4 passes**: PDF incorrectly produced 409 instead of 415, binary/missing-identity responses produced 409 instead of 502, and a null-content envelope could be accepted. After the fix the same file gives **8/8 passing**. No successful binary response is now interpreted as proof of a Vault change.

## Separate identity evidence

The two identity strings reported by the parent are exactly reproducible from the **same** Windows path `C:/Users/Meta/Documents/Obsidian/STEM`, without contacting the live service:

- HTTP scoped identity: SHA-256/base64url of `vaultPathKey(root)`, which lowercases the resolved Windows path: `XyoFkWO6jDqRH9s12fvmjcHTNzvwrOKYZbDarMRnKLg`.
- Operations `get_context.vault`: SHA-256/base64url of the resolved root with original case: `tvGPSzxCasaTjlyaNlPC1Wzr_hFmzX8m8pMzyVxGOnU`.

Authoritative sources are `vaultConfigurationIdentity` / `vaultPathKey` and `callOperation` / `hash(root)`, respectively. Their inequality therefore does not establish a Vault switch or a restart-related identity change. This repair deliberately leaves that separate operations contract alone. Historical service restarts or any additional real identity mismatch remain outside the proven PDF failure chain.

## Changes and ownership

- `web/src/lib/media.ts`: relocates the existing store text-extension regex as `TEXT_EXT_RE`; `store.ts` reuses it at its five existing checks. The extension set is unchanged and still matches the server's text allowlist.
- `web/src/components/Editor.tsx`: central, sidebar and restored split adapters pass only text paths into `useDocumentSession`. Binary paths share `AttachmentView`, so no binary session, Markdown editor or document save timer is created.
- `web/src/components/AttachmentView.tsx`: explicitly states that in-app PDF reading is unsupported; waits for the existing Vault identity bootstrap, uses `api.rawUrl`, and offers browser-open/download links. No iframe, embedded workspace, new fetch pipeline or PDF renderer. Genuine stale state hides the actions and displays the existing reload/session-preservation message. Electron's existing HTTP(S) window-open handler delegates to `shell.openExternal`; its actual OS handoff was not exercised here.
- `web/src/lib/api.ts`: rejects non-text document reads with 415 before HTTP, protecting direct registry/plugin callers as well as UI entry points. Malformed text envelopes fail visibly with 502 before the identity comparison; valid envelopes with a different Vault and HTTP `VAULT_CHANGED` still permanently invalidate the client.
- Existing server identity and request/stream lease implementation remains unchanged. The focused server test proves valid PDF 200/206 bytes and rejection of missing/stale identities, including header precedence over the query identity.
- No new parser, session registry, writer, index, cache, polling, input listener or architecture layer. Added work occurs only on file-open/response validation. No measured performance claim.

## Validation

All filesystem fixtures were under `C:/Users/Meta/AppData/Local/Temp/.agents/` and removed by the existing test teardown. Browser tests use isolated Edge contexts and request fixtures on a dedicated Vite port, with `RENDER_TEST_SKIP_CORE_BUILD=1`. No backend was launched against the user's Vault; no root `server/public` build output was regenerated.

1. `npx vitest run server/src/services/vaultClientIdentity.architecture.test.ts server/src/services/vaultRequestLease.architecture.test.ts server/src/services/vaultDocumentIdentity.architecture.test.ts`: **17/17 passed**, 1.46s. The existing missing-file lease test intentionally logs ENOENT while asserting its error path; it is not a failed test.
2. Focused Edge command: `npx playwright test tests/browser/pdf-identity.spec.ts --project=render`, with browser executable `C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`, port 5209, skipped core build, output `.local/pdf-identity-20261025/browser-final-pass`: **3/3 passed**, 6.5s.
   - Central PDF opens a non-editable attachment page with an encoded scoped URL; no binary text-read request, no iframe or Markdown editor; actual layout PUT carries `X-Vault-Identity: browser-fixture` and persists `activePath: paper.pdf`; returning to the note reuses the original session and bytes.
   - Sidebar PDF plus restored binary split cannot create sessions even through direct `DocumentRegistry.open`; both return 415, only the original note session remains, and its held unsaved draft stays dirty and unchanged while layout saves succeed.
   - A controlled real `VAULT_CHANGED` HTTP response still rejects layout persistence, emits the save-failure notification, sets stale state and hides attachment actions. The controlled 409 console error is explicitly expected; no unexpected runtime errors.
3. `npm --workspace web run typecheck`: passed.
4. `npm --workspace server run typecheck`: passed.
5. `git diff --check`: passed, including final source/report closeout. Dedicated browser port 5209 has no remaining listener after Playwright teardown.

Browser-fixture corrections during development: the conflict route initially omitted `/api/uistate/`'s trailing slash, so the intended 409 was not injected; this was corrected. A later assertion incorrectly required the save notification to remain the last toast despite another asynchronous stale error; it now observes the notification stream. Final tests retain the real conflict behavior and error reporting, with no product changes to suppress failures.

## Acceptance boundaries

This is source/unit/isolated-browser evidence. Full suites, native installed 0.1.27, real PDF viewing in the external browser, Electron OS handoff, live-Vault state recovery, physical input and long-run behavior were not tested. The currently installed app still needs a separately authorized parent delivery to contain this patch. Existing stale windows are not silently rebound or auto-reloaded by the repair.
