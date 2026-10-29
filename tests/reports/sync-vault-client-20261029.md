# Vault-owned sync configuration and Windows client 0.1.34

## Scope and ownership

User requested an updated client and synchronization configuration carried by the Vault,
so opening a Git clone discovers native file transport without reentering credentials.
The only connection authority is `.obsidian/webobsidian/sync.jsonc`: enabled flag,
ordered endpoints, token and interval. Reuses the native JSONC reader and revision-CAS
writer, existing watcher, engine, Git queue and maintenance gate. Removes application
settings' connection map; no implicit legacy import or duplicate store. Local checkpoint,
outbox, incoming journals, cached blobs and retained conflicts remain device-local.

Git backup explicitly includes this one configuration through an ignored `.obsidian`
folder. Periodic backups retain device/conflict branches and additionally attempt a
normal push to the selected repository branch, enabling a default clone. A rejected
or diverged repository branch never causes pull, merge, force-push or local overwrite.
The successfully published device backup remains available. No per-save Git is added.
Credentials intentionally travel with the Vault: use a private repository.

## Source validation

- Final full unit suite: 459/459, 82 files, 13.00 seconds.
- Focused configuration/Git/runtime: 14 cases, included in the full suite.
- Actual Git repositories: ignored native config tracking, default remote clone,
  per-device backup, divergent main preserved, no remote note pulled into the Vault.
- Real application/hub with fresh DATA_DIR and cloned Vault: discovers masked
  connection and uploads actual files; invalid JSONC does not crash application startup.
- Actual watcher/maintenance integration: dirty editor refusal, binary download/upload,
  synchronized configuration, masked-token save and no token in application settings.
- Server/Web/Desktop types passed. Initial test-only unknown JSON type was fixed.
- Related browser suites: 15/15 settings/buttons/MCP/open-editor cases (40.1 seconds),
  4/4 sidebar cases (9.2 seconds). Two backend proxy shutdown warnings occurred after
  fixture closure; all tests and renderer-error assertions passed.
- First divergent-Git fixture setup was stale after a previous successful primary
  branch push; advanced the disposable second clone before simulating divergence.
  Final full suite passes; product never performs this test-only pull.

## Delivered Windows client

- Product source: `8edf4f3f45bb8a315e9612a66417418e9268e7a2`, normally pushed to
  origin/main. Version 0.1.34 avoids the other chat's reserved 0.1.33 draft.
- Fresh exact Git archive built core/Web/server, standalone desktop bundle and NSIS.
  Initial archive dependency linking omitted workspace-local packages (`ts-dedent`);
  linked those existing project dependencies and repeated the full build successfully.
  No global dependency installation or root public rebuild was performed.
- Installer `desktop/release/0.1.34/WebObsidian-0.1.34-win-x64-setup.exe`:
  105,619,866 bytes, physical file version 0.1.34; blockmap and BUILD-INFO alongside.
- Actual unpacked standalone runtime integration: 2/2 (3,924 ms); production SPA
  5,741 ms, all nine groups passed, zero renderer errors. Includes existing personal
  merged-table dark/light/live/reading and MCP/Pele features.
- Actual packaged Electron and actual installed Electron each passed automatic
  connection bootstrap, strict sequential fallback, two-way note transfer and exact
  688,925-byte PNG transfer. Native settings show ordered addresses and private-repo
  warning; token masked; Vault config unchanged; zero renderer errors.
- Normal silent NSIS upgrade: exit 0, OMEN 0.1.28 -> 0.1.34.0, installed asar
  0.1.34 and installed standalone server bytes match the accepted package.
  Existing desktop/server settings match pre-install backups byte-for-byte.
  No existing application process was force-closed; isolated test windows exited.
- Published GitHub Release v0.1.34, non-draft/non-prerelease, target/tag both equal
  product source above; remote three asset names/sizes verified. Other chat's 033
  draft is unchanged. No other-platform release/install is claimed.
- Root public entry length/UTC ticks unchanged. Old local 032 assets and this task's
  temporary source/archive deletion was policy-rejected, not retried; moved reversibly
  into `Temp/.agents/.trash/webobsidian-client-034-20261029` as permitted by user rules.
  Active desktop/release now contains only 034. Manifest in cleanup-result.json.
- Evidence: `Temp/.agents/webobsidian-sync-vault-20261029/` contains build/package
  logs, production-spa, packaged-native, installed-native, installation-result.json,
  cleanup-result.json and installation backups; no credentials are recorded here.

## Live-data boundary

Root public, installed profile and real Vault are preserved.
STEM's parent has Syncthing markers: do not enable a second live writer, migrate/seed
real notes or alter Syncthing ownership. ROG backend, gateway and Sakura are unchanged.
No other-device installation or physical multi-device acceptance is claimed.
