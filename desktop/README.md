# WebObsidian Desktop (Electron)

Packages WebObsidian as a desktop app for **macOS / Windows / Linux**
(Windows: x64 installer; macOS/Linux: arm64 and x64). It is a thin **Electron shell** around the unchanged
`server/` (Express) + `web/` (SPA): the shell spawns the server as a child process
bound to `127.0.0.1` on a random free port and loads it in a `BrowserWindow`.

Because the server has **no runtime native modules**, the whole server is bundled
into a single `.mjs` with esbuild, and every CPU arch is produced just by packing
the matching prebuilt Electron binary — no cross-compilation, no `node-gyp`.

## How it works

- **First launch** prompts for a vault folder (default `~/Documents/WebObsidianVault`).
- App data (`settings.json`, search index) lives in Electron's per-user `userData` dir.
- The desktop opens its loopback-only server directly. Account, session, API-key
  and public-sharing code has been removed.
- **F10 → File → Switch Vault…** changes the vault on Windows/Linux (relaunches to re-index);
  **Open Vault/Data Folder** and **Open Logs** help debugging.
- On Windows/Linux, compact **file tabs and sidebar toggles** share a single 32px
  row with native window controls. Drag its empty area to move the window; F10
  opens the native application menu. The extra note and formatting headers are
  removed. Right-click a tab for file actions; use the bottom-right icon menu for
  reading/source/live views. The left ribbon hides with the left sidebar.
  macOS keeps its system menu bar (including File → Switch Vault…).
- Git sync needs `git` on the machine; without it the app still works for local editing.

## Build locally

From the **repo root** (builds web + server first, then the desktop app):

```bash
npm install
npm run desktop          # build everything + launch the app (dev)
npm run desktop:dist     # build this platform's packages; Windows: NSIS setup
```

To build the Windows x64 installer without publishing or launching it, run
from the repo root:

```bash
npm run build
npm --workspace desktop run dist -- --win --x64 --publish never
```

Every `dist`, `dist:dir`, or `dist:publish` run first deletes the entire previous
`desktop/release/` directory, including older versions and unpacked outputs.
Only the new build is retained in `desktop/release/<version>/`. Run packaging
through these npm scripts so the cleanup hook is applied; direct
`electron-builder` invocations bypass it. Desktop `dist/` and `.gen/server/`
are also regenerated from scratch. This cleanup does not touch vaults or app data.

Windows builds produce `WebObsidian-<version>-win-x64-setup.exe`.
The default Windows target is a per-user NSIS installer for local builds and
release CI. It allows choosing the installation directory, creates a Start menu
shortcut but no desktop shortcut, and does not launch the app automatically.
Installation refuses to continue while WebObsidian is running; it never uses
the installer's default process termination behavior. Save and exit first.
The personal installation directory is `%LOCALAPPDATA%/Programs/WebObsidian`.
App data and the selected Vault stay outside the installation directory and are
not deleted by uninstalling. Building a package does not install or launch it.

For later local fixes, rebuild the affected frontend/server/desktop bundle rather
than the installer. Close the app before replacing installed files. Replace the
whole frontend asset set and its entry together; keep frontend/server/core
changes from one source revision together. Desktop main/preload changes require
regenerating `resources/app.asar`. Electron or native dependency changes require
a complete distribution update. Do not run the release cleanup against an
installed app or mix live partial writes with a running app.

Or directly inside `desktop/` (assumes `npm run build` already ran at the root):

```bash
npm run build        # esbuild: dist/ (main+preload) + .gen/server/ (server bundle + SPA)
npm run check:bundle # static standalone dependency check; does not start the server
npm start            # launch with the already-built bundle
npm run dist         # electron-builder → packages; Windows: NSIS setup
npm run dist:dir     # fast unpacked build (no installer), for smoke testing
```

> Note: this environment may export `ELECTRON_RUN_AS_NODE=1` globally (Electron then
> behaves as plain Node and `require('electron')` returns a path). When launching
> Electron by hand, clear it: `env -u ELECTRON_RUN_AS_NODE electron dist/main.js`.
> Packaged apps are unaffected. The shell sets `ELECTRON_RUN_AS_NODE=1` only for the
> server child it spawns.

## Startup errors

Startup failures report the server log path. On Windows it is
`%APPDATA%/@webobsidian/desktop/logs/server.log`. A child that exits before its
health check passes is reported with its exit status, rather than waiting for
the full startup deadline. Version 0.1.6 allows up to 120 seconds for a live
server to finish cold Vault indexing before the HTTP listener opens. The log
records each startup time and elapsed time until its health check succeeds.

Version 0.1.8 displays a loading window while the local server indexes the Vault.
Its Windows portable launcher uses an independent extraction directory per launch,
so opening the EXE again focuses the existing window without deleting its web
resources. Test this actual launcher behavior with a disposable profile/Vault:
`npm run test:desktop-portable -- desktop/release/0.1.8/WebObsidian-0.1.8-win-x64-portable.exe`.
The server still completes its initial index before opening the workspace.

Version 0.1.7 also fixes a native LaTeX configuration initialization cycle that
could leave the window blank after the server was healthy. To check the real
production entry and integrated note workflows with a disposable fixture, run
`npm run test:packaged-startup -- desktop/.gen` after the desktop bundle build,
or pass `desktop/release/<version>/win-unpacked/resources` after packaging.

The 2026-10-18 Windows 0.1.1 build could fail with
`Cannot find module './impl/format'`: the standalone bundle had selected
`jsonc-parser`'s UMD entry. Version 0.1.2 uses its ESM entry and rejects surviving
relative `require` calls during the build. See
[desktop runtime](../docs/design/desktop-runtime.md) for the packaging contract.

## Releasing (GitHub Releases)

For this fork, every new Windows portable delivery must also be published to
`AlexbeatsZ/webobsidian` as an asset of the matching `v<version>` GitHub Release.
This is the default delivery workflow: build in an isolated source directory,
complete the required build/static checks, then upload the exact delivered EXE.
Record the build commit and verification boundary in the release notes and check
the remote asset name and byte size after upload. Publishing does not require
launching the application or running runtime acceptance. Do not overwrite an
existing asset or move an existing tag to silently replace a published build.

For an already-built portable EXE, publish it without rebuilding:

```powershell
gh release create v<version> desktop/release/<version>/WebObsidian-<version>-win-x64-portable.exe --repo AlexbeatsZ/webobsidian --target <build-commit> --title "WebObsidian <version>" --notes-file <release-notes.md> --latest
```

If that version already has a release, upload a missing asset with
`gh release upload v<version> <portable.exe> --repo AlexbeatsZ/webobsidian`.
The desktop publisher configuration also targets this fork.

The optional CI build workflow is separate from uploading an existing local EXE:

CI workflow [`.github/workflows/release.yml`](../.github/workflows/release.yml) runs on
a version tag and builds on three native runners in parallel:

```bash
npm version patch -w desktop   # or bump versions as you prefer
git tag v0.1.0
git push origin v0.1.0
```

Each runner (macOS/Windows/Ubuntu) packages its platform's artifacts and uploads
them to a **draft** GitHub Release for the tag. When all three finish, open the draft
release on GitHub and click **Publish**.

Artifacts:

| Platform | Formats | Arch |
|----------|---------|------|
| macOS    | `.dmg`, `.zip`         | arm64, x64 |
| Windows  | portable `.exe`       | x64 |
| Linux    | `.AppImage`, `.deb`    | x64, arm64 |

The apps are **not code-signed/notarized**, so users will see a Gatekeeper /
SmartScreen warning on first launch (expected for a free self-hosted build).
