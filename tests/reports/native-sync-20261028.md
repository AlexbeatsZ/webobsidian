# Native file sync — 2026-10-28

Final source validation completed on 2026-10-29 (America/New_York).

## Delivered source

- Strict ordered address list. Each new attempt starts with the first entry, without route categories, racing, ranking or last-success promotion. Authentication, workspace identity and rollback errors stop rather than switching authority.
- Native Markdown/Canvas/binary transport: immutable streaming blobs, exact-version CAS and atomic manifest publication, tombstones, durable operation IDs/receipts, local incoming journal and retained conflict copies.
- Reuses the existing watcher/fileupdates, Vault path resolver, physical write queue and maintenance lease. No additional watcher, index, editor, session or text parser.
- Existing application data directory owns Vault-scoped connection settings and credentials. General settings responses omit sync secrets; the dedicated endpoint returns only the token mask.
- Git is not live file transport when native sync is enabled: commit-on-save and automatic pull are suppressed. The existing timer backs up to per-device branches; conflicts additionally preserve exact local/remote blobs in separate Git branches without changing HEAD or the real index.
- The settings panel accepts one address per line and explicit version choices. Opening/saving does not issue a manual-run request; explicitly enabling synchronization opts into the background schedule.
- Maintenance releases clients before flushing file/configuration/index notifications. Read-only plugin adapter requests arriving during the lease wait for release, recheck Vault identity and do not count as pending writes; mutating adapter requests still fail closed.
- Shared gateway wrapper adds only `/webobsidian-sync/v1/`, preserving original Dayweave/subscription and Mojian handlers. The backend and client default port share one protocol constant.

## Verification

| Layer | Result |
| --- | --- |
| Full Vitest suite | **450/450**, 81 files, 8.16 s |
| New focused cases included above | **24/24**: engine13, Git4, gateway2, runtime1, notification/lease4 |
| Server / Web / Desktop types | All pass |
| Settings + buttons + MCP/native-editor browser regression | **15/15**, 30.2 s |
| Adjacent sidebar/workspace browser regression | **4/4**, 7.3 s |
| Actual open-editor native refresh repeated independently | **5/5**, 17.2 s |
| Isolated production Web build + standalone server bundle guard | Pass |
| Actual bundled server native sync integration | **1/1**, 2639 ms |
| Production SPA startup/edit/disk-save/native-feature smoke | Pass, **5496 ms**, zero renderer errors |
| Root server/public entry size and UTC write ticks | Unchanged |

The native integration starts a real application subprocess and a real temporary hub, connects a fixture WebSocket client to the existing maintenance protocol, refuses incoming publication while that client reports unsaved text, then verifies binary download, local-note upload and an externally written attachment discovered by the actual watcher. It also checks masked credentials and rejected public HTTP settings. The same integration runs against the standalone production bundle, not only TypeScript source.

Other focused tests verify raw Markdown/Canvas/PNG/PDF bytes, binary replacement/rename/deletion, exact retained conflict copies and both explicit choices, offline restart, lost-response replay with the same operation ID, journal recovery without network, preservation of post-interruption local edits, Syncthing/link exclusions, address order, fatal auth/identity failures, CAS, receipts, unsafe paths and same-version content corruption. Actual temporary Git repositories prove HEAD/index preservation and backup pushes to a temporary bare remote. No live Vault is used.

Browser settings tests use controlled API responses; a separate actual-backend/real-hub browser case verifies an already-open clean CodeMirror document refreshes remote bytes after lease release, preserving raw BOM/CRLF on disk. These are not two-physical-device or public Sakura acceptance. The repeated case exposed a read-only plugin adapter request racing the next lease; shared adapter operation classification and lease waiting fixed the race without allowing writes. It passes five fresh repetitions and the final integrated browser run. Fixture setup failures (React module interop / label-group ambiguity / native ESM loading / browser executable environment) and the initial missing `/api` prefix were corrected before the final passing run. Existing MCP fixture teardown emitted Vite proxy connection-refused diagnostics after backend shutdown; all assertions and renderer-error checks passed. The production build retains its existing large-chunk advisory.

## Evidence

- `C:/Users/Meta/AppData/Local/Temp/.agents/webobsidian-sync-production-20261028/`: final unit/build logs, standalone production output, `production-sync.log`, production screenshots and `evidence/result.json`.
- `C:/Users/Meta/AppData/Local/Temp/.agents/webobsidian-sync-browser-final-20261029/`: final browser output and settings/conflict screenshots.
- `C:/Users/Meta/AppData/Local/Temp/.agents/webobsidian-sync-refresh-final-20261029/`: five-repeat native open-editor refresh output.
- Design: `docs/design/file-sync.md`; backend/deployment instructions: `sync-server/README.md`.

## External state and boundaries

Read-only ROG discovery on 2026-10-28 confirmed loopback18742 and all-address18743 are already owned by the same Mojian process, and the shared gateway remains on loopback18781. **WebObsidian defaults to the then-unused18744**, not18743. This is only a proposed backend listener; no WebObsidian service was started there.

No ROG scheduled task, shared gateway action, firewall rule, SakuraFrpService, Tailscale, live Vault, Git remote configuration or installed client was modified. No public Sakura request/physical-device synchronization is claimed. Enabling the new service and gateway route requires explicit approval and preservation of the existing task configuration.

Desktop0.1.33/version/build ranges remain reserved by the separate button-style delivery. This change does not bump a competing version, publish an installer or claim a new installed release. Its isolated production build is verified, not an NSIS/client deployment.

Empty directories are not synchronized. Case aliases, file/directory shape conflicts, unsupported filesystem paths and active Syncthing roots fail closed. History/receipts/blobs have no automatic GC; binary conflicts are not automatically merged.
