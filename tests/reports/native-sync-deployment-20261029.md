# Sakura native file sync deployment — 2026-10-29

## Scope and authorization

The user explicitly approved enabling the independent ROG backend and adding its route
to the existing shared Sakura Web gateway. Deployed product source is
`b86771fd196219bed5ab993f4a375f51b28345ac`; this delivery does not change product code,
installed clients, live Vaults, firewall rules or release/version ownership.

## Active deployment

- Host: ROG, `meta@100.106.169.46`.
- Runtime: `C:/Users/Meta/Project/Workspaces/webobsidian-sync/`.
- `WebObsidianNativeSync` startup task: existing Node runtime, Meta / S4U / Limited,
  restart-on-failure settings, backend `127.0.0.1:18744`. Task observed Running;
  reboot/startup execution has not been physically tested.
- Shared gateway remains `127.0.0.1:18781`. Its task action now starts the deployed
  `sync-server/shared-gateway.mjs`, importing the original Dayweave gateway module and
  existing Mojian route module. XML comparison confirms all non-action task fields
  remain unchanged. Only the gateway process was restarted.
- Public endpoint: `https://cdn.u3146344.nyat.app:63573/webobsidian-sync/v1/`.
- Production workspace: `76fcca29-885b-4dd1-832e-cfac4f07cc09`; authenticated public
  readback confirmed **revision0 / files0 / HTTP200**. No test or real notes were seeded.
- Production connection/token and configuration remain in ACL-restricted ROG
  `.local/native-sync/connection.json`, `server.json` and `production.json`. Never
  print these files or commit their contents. No new global software or environment
  changes were needed.

## Actual public HTTPS acceptance

Acceptance used a different token and isolated server data directory, plus two temporary
Vaults on OMEN running the actual TypeScript `FileSyncEngine`. Requests traversed the
real Sakura HTTPS origin with default certificate verification; TLS verification was
not disabled. All **11 acceptance groups passed**:

1. Authenticated public manifest reaches an initially empty acceptance workspace.
2. Missing token, browser Origin and non-protocol paths are rejected.
3. Markdown BOM/CRLF, Canvas, PNG/PDF/audio/video binary fixtures arrive byte-exact.
4. A second client edits a note and the first receives the exact return bytes.
5. Binary rename and deletion propagate, with server tombstones retained.
6. An unavailable first address falls back sequentially to public HTTPS; both passes
   restart at entry one without promoting the last successful address.
7. Offline local changes remain intact and converge after reconnecting.
8. A binary conflict preserves both exact versions; explicit local choice converges.
9. Explicit remote choice adopts the retained remote bytes.
10. A deliberately lost successful commit response replays the same durable operation
    ID after a client restart rather than committing a duplicate operation.
11. Authentication failure stops immediately and does not try the next address.

Acceptance reached its own revision10. The backend was then stopped, switched to the
separate production configuration and started again. Production rejects the acceptance
token. The acceptance server data, test credentials and transferred source archive were
removed only after checking exact paths, active production configuration and acceptance
workspace identity. Production data/configuration and rollback files are retained.

## Existing service preservation

Loopback responses before/after gateway replacement are byte-identical for the existing
authenticated Mojian manifest, invalid Dayweave usage request and two subscription
404 probes. These are bounded regression probes, not full valid-subscription or
Dayweave pairing acceptance.

Six listener/service observations have identical PID and normalized UTC start time:

| Scope | PID | Start UTC |
| --- | --- | --- |
| Dayweave49732 | 48952 | 2026-10-29T04:01:57.5259553Z |
| Subscription18782 | 46056 | 2026-10-28T04:50:21.5320437Z |
| Mojian18742 and18743 | 49068 | 2026-10-29T03:10:59.2346904Z |
| SakuraFrpService | 37756 | 2026-10-26T13:33:19.3679152Z |
| Tailscale | 11928 | 2026-10-26T03:58:28.6252928Z |

The gateway changed from PID28200 to PID12712 as expected. No unrelated process was
stopped. Backend18744 is loopback-only: private-network direct listeners/firewall access
were **not** added, and this report does not claim successful LAN/Tailscale direct sync.

## Recovery and evidence

- ROG original task backup:
  `C:/Users/Meta/Project/Workspaces/webobsidian-sync/.local/native-sync/gateway-task.previous.xml`.
- ROG recovery script:
  `C:/Users/Meta/Project/Workspaces/webobsidian-sync/.local/native-sync/rollback.ps1`.
  It restores the original gateway task and stops/disables only the new backend while
  retaining sync data. It is prepared, **not executed**, and requires a rollback request.
- Local evidence:
  `C:/Users/Meta/AppData/Local/Temp/.agents/webobsidian-sync-deploy-20261029/` contains
  sanitized acceptance/results, activation/postcheck logs and temporary fixture clients.
  Temporary local connection files containing acceptance/production tokens were removed.
- ROG `.local/native-sync/deployment-result.json` retains process/task evidence;
  `BUILD-INFO.json` records deployed product provenance.

No installed-client update, real Vault selection/migration/seed, physical mobile sync,
reboot acceptance, direct-network success or new installer/Release is claimed. Git
backup/conflict-branch behavior remains the source-tested implementation recorded in
`tests/reports/native-sync-20261028.md`; no real user's Git backup configuration changed.
