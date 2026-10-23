# Desktop server packaging and startup

## Standalone server contract

The desktop build copies the built SPA and bundles the compiled Express server
into `resources/server/dist/index.mjs`. It does not ship the server's
`node_modules` tree. The desktop shell starts this entry with its own Electron
executable and `ELECTRON_RUN_AS_NODE=1`, bound to a random loopback port. User
vault/config/data paths are passed separately and are not build inputs.

The server bundle aliases only `jsonc-parser` to its supplied ESM entry. Its
default UMD entry passes `require` into a factory; esbuild leaves calls such as
`require2('./impl/format')` in the bundle. Those files are absent from the
standalone distribution. This caused the 2026-10-18 Windows 0.1.1 package to
exit at import time, confirmed by the user's 2026-10-19 server log. Increasing
the startup deadline does not address that import failure.

`desktop/scripts/check-server-bundle.mjs` rejects surviving literal relative
`require` calls in esbuild's generated output before packaging. It can also
inspect the actual `win-unpacked/resources/server/dist/index.mjs` without
importing or starting it. This catches the reported UMD packaging regression;
it is not a general proof that every dynamic import or startup path will work.

## Startup failure reporting

Open the server log before spawning the child. Capture both stdout and stderr
until the child's streams close, and finish writing them before reporting its
exit. Record spawn errors and early exits while polling `/healthz` so a crashed
child fails promptly with its exit status and log path. A live child has a
120-second startup deadline because the HTTP listener opens only after the
initial Vault index is ready. On 2026-10-22 the 0.1.5 cold start wrote settings at
23:32:34 UTC and its rebuilt index at 23:33:14 UTC, then logged its listener;
the former 30-second deadline had already displayed a startup failure. Version
0.1.6 allows this indexing time and logs each startup's UTC time, port, deadline
and elapsed time until health succeeds. Child-exit failures still report promptly;
the longer deadline does not conceal missing dependencies or other child exits.

On Windows the log is under
`%APPDATA%/@webobsidian/desktop/logs/server.log`. Startup diagnostics must never
print the persisted secret or reset desktop config/vault data to fix packaging.

## Production renderer boot (0.1.7)

A healthy server is not sufficient for a usable desktop. The 0.1.6 blank window
was reproduced with a production-entry ReferenceError: CodeMirror calls a
Facet's combine([]) during Facet.define, while the native LaTeX settings module
can still be evaluating through its math-context/conceal imports. The facet now
has an inert undefined default; its getter lazily creates and caches the fallback
after module initialization. The document registry also avoids eager workspace
store imports through automatic folder-tag saves.

Run `npm run test:packaged-startup -- <resources-directory>` after bundling. It
starts the actual standalone bundle with a disposable Vault and opens the real
production SPA, then checks login, note typing/disk save, native snippets,
command-backed templates, JS/custom blocks, equation references, body titles,
view modes, pinyin search, configured menus, attachment scan protection and
right tabs. It fails on renderer initialization/runtime errors. This is browser
and server integration evidence; native Electron window controls and guests
still require separate desktop acceptance.

## Portable launcher lifetime (0.1.8)

The 0.1.7 native-window failure was reproduced against the real portable EXE:
its first launch could render/edit/save, but a second launch removed the first
instance's `resources/server/public/index.html`. Electron's single-instance
lock correctly rejected the second app, after its NSIS launcher had already
reused the first launch's extraction directory. On exit, that launcher recursively
cleaned the shared directory. Locked EXE/DLL/asar files remained, concealing the
loss until a page or lazy asset was requested; `/healthz` still returned success.

Set `build.portable.unpackDirName: true` for the pinned electron-builder 25.1.8.
Its actual `NsisTarget` implementation treats true as per-launch `$PLUGINSDIR`
and otherwise defaults to one build-specific directory. Do not change this to
false based on the contradictory option comment; check the installed source
and real portable regression when upgrading electron-builder. Each launch must
clean only its own extraction, including a rejected second instance.

The BrowserWindow now appears before server indexing with a local, script-free
loading document. A second click focuses this window. Once health, login and
userscripts are ready, the same window loads the workspace. The server still
indexes before listening; this does not implement background indexing.

`npm run test:desktop-portable -- <portable-exe>` runs the actual launcher with
a temporary `--user-data-dir`, disposable Vault and Electron's real Chromium.
It checks native auto-login/edit/save, a second launcher exiting without removing
the first app's resources, HTTP 200 and a successful native renderer reload. It
failed on 0.1.7 at the missing-index assertion. This test complements the
production-browser regression, which cannot cover the NSIS extraction lifetime.

## Persisted Vault selection and local test data

On Windows the desktop profile is
`%APPDATA%/@webobsidian/desktop/`. `desktop-config.json` stores `vaultPath`,
which the desktop passes as the server's `VAULT_PATH` startup default.
`server-data/settings.json` stores the effective `vault.path`. An existing
settings file takes precedence over that startup default; changing only the
desktop file does not change the Vault used by an existing server settings file.
When changing the saved selection offline, back up and update both files while
preserving authentication secrets and unrelated preferences. An already running
server retains its in-memory settings; offline edits take effect on next launch.

For this checkout, disposable test data lives in `.local/test-vault/`, copied
from the previously effective STEM Vault. The entire root `.local/` directory is
Git-ignored, including configuration backups and `test-vault-manifest.json`.
All program tests must use this copy or another disposable fixture, with no
symlinks/junctions to live notes and no sync back to the source. The copied
`obsidian-context-mcp` plugin is disabled to avoid reusing the real MCP endpoint.
Both saved Vault paths point to this copy, and the server's saved allowed roots
are limited to the test Vault. Verify the effective server and native desktop
paths before any separately authorized runtime test. Creating a test Vault does
not change the user's static-only acceptance instruction.

## External configuration files (2026-10-23)

`window.webobsidianDesktop.openVaultPath(path): Promise<void>` is a narrow
preload/main IPC entry for the existing settings path rows. It reuses
`desktopWindow` to accept only the current local application main frame; WebViewer
guests and other frames cannot invoke it. It works without enabling native plugins.

Relative paths resolve beneath the effective Vault from
`server-data/settings.json.vault.path`; `desktop-config.json.vaultPath` is only a
fallback when that server settings file is absent. Absolute paths remain supported
for existing snippet configuration outside the Vault. Invalid/malformed settings,
escaping relative paths, missing targets and OS-open failures propagate to the
setting row. Opening never creates a missing configuration file or directory.

`desktop/src/paths.ts` is shared by this IPC, the existing Open Vault Folder menu
and UserscriptService's Vault refresh. It owns effective-Vault precedence and the
existing-file/system-open check, replacing the former userscript-only copy.
No HTTP route, local service, watcher, content cache or additional store is added.
The web declaration in `lib/desktop.d.ts` mirrors the existing limited preload API.

This follow-up is source/diff-only: no tests, types/build/probes, app/server/browser
or native open operation was run. Runtime/OS association/Vault-switch acceptance
remains unverified and existing release outputs are unchanged.

## Local build retention

Windows builds use only the x64 portable target, producing
`WebObsidian-<version>-win-x64-portable.exe`. This applies to local npm packaging
and release CI through desktop/package.json. The NSIS setup target/configuration
was removed on 2026-10-22 at the user's request. macOS/Linux targets are unchanged.
Packaging never installs or launches the generated application.

Keep only the latest local desktop deliverables. The npm `dist`, `dist:dir`,
and `dist:publish` commands run `clean:release` first, deleting the entire fixed
`desktop/release/` directory before packaging to `release/<version>/`. The cleaner
refuses a redirected release directory. `scripts/build.mjs` also clears desktop
`dist/` and `.gen/server/` before generating their replacements. Vaults, user
configuration, app data and dependencies are outside the cleanup scope.

For isolated packaging that invokes electron-builder directly, explicitly run
`npm --workspace desktop run clean:release` before the packaging step. Build web
and server in `Temp/.agents/` when the existing app and `server/public` must be
preserved; cleaning release outputs does not authorize replacing a live runtime.

## Verification boundary

Use type checks, production builds and the static bundle check when the user
requests static verification only. Do not launch Electron, the server, the
installer, a browser, or a real vault for acceptance under that instruction.
Report successful packaging separately from user-confirmed startup/workflows.
