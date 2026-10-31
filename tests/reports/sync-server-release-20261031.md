# Standalone WebObsidian sync server — 2026-10-31

## Scope and architecture

Independent server 0.1.0 retains the `sync-server/server.mjs` CLI and
`createSyncServer({root, token, maxBlobBytes})` export, default loopback port 18744,
`/webobsidian-sync/v1/`, and gateway module/handler exports. `protocol.mjs` remains
unchanged. The former storage/blob/CAS/receipt kernel is removed from server.mjs;
the adapter calls the separately released, pinned `@alexbeatsz/file-sync-core`.

The standalone npm workspace, CLI/config example, packaging script and dedicated
tag workflow are independent of desktop/mobile versions and builds. Packages retain
`sync-server/` so the existing KeePass outer gateway can keep importing
`addFileSyncRoute` from the same deployment-relative path. Package contents include
the tested core source, its license/notices/provenance, and BUILD-INFO. Deployment
requires Node 22+, with no runtime package installation or other source checkout.

There is no new process, parser, watcher, index, protocol, automatic GC, seed,
credential migration or data-root migration. This is code reuse and release
separation; no memory/throughput improvement has been measured.

## Isolated verification

All state and file operations use disposable directories in the OS Temp `.agents`
tree. No production Vault, profile, backend, endpoint, task or gateway was accessed.

- Protocol/CLI: 8/8 node:test cases pass. Token and path restrictions, Origin/query/raw
  fragment rejection, malformed/oversize commits, absent blobs, hash mismatch,
  streaming upload limits, workspace mismatch, case/shape collisions, exact CAS,
  null tombstones, atomic batch revision, history, original receipt replay and
  unchanged state bytes across restart. Also checks old manifest/state loading,
  writer-lock exclusion, gateway exports/fallback order, config/environment
  precedence, cwd-relative dataDir, help/version, listener failure cleanup and
  signal-listener cleanup.
- Actual current `FileSyncEngine`/`OrderedSyncTransport`: existing 13/13 tests pass.
  An additional current-client test passes lost-successful-receipt replay after
  restarting both server and client, raw binary/CRLF/Unicode round trips, exact
  local/remote conflict copies and explicit resolution.
- Migration rehearsal: original pre-core `server.mjs` from source baseline
  4234492 generated real state/blob/history/receipt in an isolated data root.
  New adapter read exactly the same state bytes and workspace identity, replayed
  the original receipt and binary bytes, returned 409 for a stale new operation,
  and old code then reopened the same data and replayed the receipt. This checks
  upgrade and code rollback without a second maintained kernel or production data.
- Server TypeScript typecheck passes, including the new current-client test.

Final dependency is the public `v0.1.0` npm-pack asset at source commit
`b191d74a61b2fe3d6855b95a3299c7e6b9591f86`, with its exact URL and SHA-512 integrity
in package-lock.json. All protocol/client/legacy-upgrade checks above were rerun
against that installed release. The local transient pre-release pack is not the
delivery dependency.

Both extracted ZIP/TAR.GZ pass real CLI startup, authenticated manifest/blob/commit,
binary byte round trip and same-root restart/receipt replay in Temp outside the
checkout, with no installation and no NODE_PATH/NODE_OPTIONS dependency. The
additional actual-current-client test also passes against the extracted server;
the 13 existing source-adapter tests pass alongside it.

Clean source build, independent CI and Release publication remain the final
closeout steps at this source checkpoint.

## ROG handoff

Use `sync-server/README.md` Upgrade/rollback steps. New runtime files include
cli.mjs, package.json, core-source.json and bundled
`sync-server/node_modules/@alexbeatsz/file-sync-core/`. Preserve private
`.local/native-sync/`, original absolute dataDir/token/identity, task account and
gateway outer-wrapper chain. Stop the sole writer before replacing runtime;
retain complete state/receipts/blobs/history. A restored old code version must use
the advanced current data, not overwrite it with a stale pre-upgrade backup.

This chat does not deploy ROG, install software, restart any production service,
construct desktop/mobile packages or perform live-client/physical acceptance.
