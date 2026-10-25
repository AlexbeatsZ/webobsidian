# Current-source isolated production acceptance — 2026-10-24

Result: PASS, including the parent's final contract/tag/index-notification wiring and real Electron close-barrier acceptance. Fresh production compilation, existing desktop server/SPA bundling and standalone guard succeeded. The final packaged server/SPA passed all seven assertion groups in headless Microsoft Edge. Real Electron passed dirty-note native close and controlled-save-failure retention/retry. No product fix was needed.

## Source and isolation

- Repository: `C:/Users/Meta/Project/Workspaces/meta-obsidian`; base HEAD `7286060ace950b56d96192885eef1aecbc5d71de` plus current concurrent working-tree changes.
- Final snapshot captured at `2026-10-25T03:52:53.324Z` (2026-10-24, America/New_York). It contains 655 current tracked/required untracked files, including the new contracts and concealMacros modules; it is not a clean-HEAD archive.
- Physical final snapshot: `C:/Users/Meta/AppData/Local/Temp/.agents/architecture-production-20261024/source-final`. Earlier `source` and its two passing smoke runs remain historical evidence.
- Verified the final snapshot includes `FileUpdateResult` owned by `server/src/contracts.ts`, Tag dialog indexing warnings/duplicate-create protection and App `index-error` notification. These product changes remain parent-owned.
- Excluded `.workbuddy`, `.git`, `node_modules`, `public`, `dist`, `.gen`, releases and TypeScript build caches. Dependency directories reuse existing external packages via junctions; the snapshot has its own dependency directory and its `@webobsidian/*` links point to snapshot workspaces. No install or global environment change.
- Before compilation, PowerShell resolved cwd and Node reported real cwd and both core workspace paths under the snapshot. Existing build scripts were invoked from that physical directory, avoiding npm workspace links back to the repository.
- `source-final-manifest.json` records source paths/sizes, tracked status, HEAD and dirty status. Final byte comparison found only concurrent workflow, design-doc and navigation-test changes after capture; no captured product source differed. The new close helper was copied into the snapshot after compilation; it does not modify the compiled product.

## Fixture contract changes

Executable repository changes are limited to `tests/packaged-startup.mjs` and the new `tests/packaged-close.mjs` auxiliary:

- Replace retired login/password-change success calls with direct local workspace startup and explicit 404 assertions for both retired endpoints.
- Configure snippets explicitly in `.obsidian/webobsidian/writing.jsonc`, with `snippetsEnabled`, `loadSnippetsFromFile` and a native `snippets/acceptance.js` path. No implicit plugin import.
- Obtain `/api/vault-identity`; use a request context with `X-Vault-Identity` for scoped API requests. Also assert missing and stale identities return 409, and verify the successful legacy-filename write directly on disk.
- Assert the actual right-side `Homepage` tab label.
- Preserve existing filename rejection, tag grammar, real editor edit/save, snippet, command/template, widget, block, equation reference, body heading, view-mode, pinyin, configured menu, attachment protection and ribbon assertions.
- Add named progress groups, optional `PACKAGED_STARTUP_OUTPUT`, server logs and machine-readable results. Failures retain the disposable fixture and screenshot/error evidence; successful runs remove disposable data and close owned browser/server processes.

## Actual commands and output

In the snapshot:

```powershell
npm.cmd run build
node desktop/scripts/build.mjs
node desktop/scripts/check-server-bundle.mjs
node tests/packaged-startup.mjs C:/Users/Meta/AppData/Local/Temp/.agents/architecture-production-20261024/source-final/desktop/.gen
node tests/packaged-close.mjs C:/Users/Meta/AppData/Local/Temp/.agents/architecture-production-20261024/source-final/desktop
```

- Search/core TypeScript builds: PASS.
- Web `tsc -b` and Vite production build: PASS, 4,087 modules transformed; final Vite phase 16.29 seconds (earlier snapshot 19.06 seconds).
- Server TypeScript compilation: PASS.
- Existing desktop build: PASS, main/preload bundles plus `bundleServer` output. Its bundled guard and explicit guard rerun both printed `[desktop] static standalone server bundle check passed`.
- Warnings retained in logs: existing mixed static/dynamic imports prevent chunk splitting; some minified chunks exceed 900 kB. These are warnings, not build failures or measured performance findings.
- Packaged resources: 282 files, 75,227,116 bytes total; server `dist/index.mjs` 4,372,511 bytes; SPA `index.html` 909 bytes.
- SPA entry: `assets/index-BJa5zstV.js`; stylesheet `assets/index-BM_63TTa.css`.
- Run 1: PASS, OS-assigned port 50658, seven groups, zero page errors, command exit 0.
- Historical run 2: PASS, OS-assigned port 57148, seven groups, zero page errors, 4,578 ms measured by the script, command exit 0.
- Final refreshed-source smoke: PASS, port 57552, seven groups, zero page errors, 3,972 ms, exit 0. Node v24.14.1; Edge 156.0.4314.42. No mocked API/renderer or Vite harness in the startup smoke.

Passed groups: production entry/local workspace/Vault identity; tag queries and scoped filename checks; real input/disk save/native snippets; command-backed template; headings/widgets/blocks/equation references; reading/source/pinyin/menu/attachment protection; right Homepage/fixed ribbon/zero renderer exceptions.

## Real Electron close barrier

- Preflight inspected desktop main/preload startup: config, server data and server logs derive from `app.getPath('userData')`; the dev desktop entry uses its own `.gen` packaged server/SPA. A disposable `desktop-config.json` selects the isolated Vault before startup. No installed EXE or user window is attached.
- Used the existing project Electron executable with Playwright `_electron`, real compiled main/preload and production SPA. Bootstrap supplies `--user-data-dir` and explicitly sets userData, sessionData, crash and log paths inside each Temp fixture before requiring product main, hence before its single-instance lock. After launch the test reads actual Electron paths, saved server settings and server log to verify the effective Vault.
- Electron 33.4.11 / Chromium 130.0.6723.191. Two isolated profile/Vault cases pass in the final `electron-close-final` run, exit 0: dirty close 1,207 ms and failure/retention/retry 1,437 ms. Their automatic server ports were 63333/63345. An earlier complete run also passed.
- Dirty success: type into the real CodeMirror editor without Ctrl+S; verify original disk bytes remain unchanged; invoke the real `BrowserWindow.close()`. Hold the resulting note PUT pending, assert the window still exists and root is inert; then release the real request to the packaged server. Renderer acknowledgement succeeds, the window closes and `will-quit` occurs. The native `closed` handler reads the file synchronously and confirms the new bytes were already on disk.
- Controlled failure: return HTTP 507 with `CONTROLLED-CLOSE-SAVE-FAILURE` for the isolated note's save request. Actual renderer save code, preload IPC and main close coordinator run. Assert failed acknowledgement, the native error title/message, live window/server, preserved dirty editor text, unchanged disk bytes and restored non-inert root. Remove the injected failure and close again; the original retained draft reaches disk before the real window closes.
- Only native `dialog.showErrorBox` is redirected to the fixture's event log to prevent a blocking modal; product close orchestration/acknowledgements are not stubbed. HTTP 507 is a controlled response injection, not a physical disk-full test. The expected 507 browser console entry is allowed; all other console errors and all uncaught renderer errors fail the test.
- The retained-window screenshot was inspected: dirty tab and `FAILURE-RETAINED-DRAFT` remain visible, with the close-cancelled error notification.
- Auxiliary development failures are retained: run 1 bootstrap newline escaping caused startup SyntaxError; run 2 passed dirty-close but cleanup called `application.process()` after Playwright disposed its dispatcher. Both were test-only defects; corrected with `String.raw` plus preflight `vm.Script` syntax checking and caching the child-process handle. Run 3 and the final run passed both native cases. No product-source modification.

## Evidence and boundaries

Evidence root: `C:/Users/Meta/AppData/Local/Temp/.agents/architecture-production-20261024`.

- `production-build.log`, `desktop-bundle.log`, `standalone-guard.log`.
- `source-manifest.json`, `acceptance-summary.json`, `protected-entry-before.json`, `protected-entry-after.json`.
- `packaged-startup-run-1.log`, `packaged-startup-run-2.log`, `run-1/{result.json,server.log}`, `run-2/{result.json,server.log}`.
- Final build: `source-final-manifest.json`, `source-final-production-build.log`, `source-final-desktop-bundle.log`, `source-final-standalone-guard.log`, `source-final-readback.json`.
- Final smoke: `packaged-startup-final.log`, `run-final/{result.json,server.log}`.
- Final native: `electron-close-final.log`, `electron-close-final/result.json`; each case retains `main-events.jsonl`, `result.json`, isolated profile/Vault and server logs. Failure-retention screenshot: `electron-close-final/failed-save-retains-window/failed-close-retained.png`. Earlier failed/passing native runs remain evidence.
- Root `server/public/index.html` retained 909 bytes and mtime `2026-10-23T12:05:49.853Z` before/after. This is bounded entry metadata evidence, not a whole-tree hash audit. Builds only wrote isolated output.
- Owned smoke/native server processes exited; successful smoke Vault/data directories were removed. Native Temp profiles/Vaults remain as evidence. Ports 5296/5297/5298 were not selected or controlled.
- No new EXE, installation, installed profile, live Vault, old release changes, staging, commit or push. Native acceptance covers the current compiled dev desktop shell using the real packaged backend/SPA; it does not validate NSIS installation or the installed app. No full browser suite, physical IME, disk-full hardware failure, long-running, other-platform or performance acceptance is claimed.
- Used the requested `long-command-wait` skill. Repository product code and shared coordination/AGENTS files were not edited. Test ownership is released with this report; the coordinator can integrate the changed test/report.
