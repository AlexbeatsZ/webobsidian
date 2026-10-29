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

## Delivery boundary

Version 0.1.34 avoids the interrupted button-style chat's reserved 0.1.33 release.
Fresh exact-source isolated build/package, production runtime, installation and release
publication are pending. Root public, installed profile and real Vault are preserved.
STEM's parent has Syncthing markers: do not enable a second live writer, migrate/seed
real notes or alter Syncthing ownership. ROG backend, gateway and Sakura are unchanged.
No other-device installation or physical multi-device acceptance is claimed.
