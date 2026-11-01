# Vault-owned synchronization and GitHub backup — 2026-10-31

## Change

The existing native connection reader already used the Vault's
`.obsidian/webobsidian/sync.jsonc`, but the actual personal Vault had no such
file. Git backup still depended on application-global settings. The new
`.obsidian/webobsidian/git.jsonc` owns the Git remote/branch, optional token,
author, scheduling and LFS patterns.

Git operations, the periodic timer, conflict branches and the settings API now
read that file through the existing Vault configuration reader and
revision-checked physical writer. The former global Git schema and settings
writer branch were removed. General settings reads remain free of additional
Vault I/O. Both connection files are explicitly committed through an ignored
`.obsidian` directory; optional Git credentials are masked and may be left empty
to use the device's existing Git credential helper.

First-use LFS upload exposed a real idle-timeout issue: LFS suppresses progress
on piped stdout, so a healthy large backup hit the existing 120-second
no-output timeout. Git now receives command-local `lfs.forceprogress=1`, without
changing global Git configuration. An initial environment-based implementation
was rejected by simple-git's EDITOR protection in isolated tests and replaced.

## Validation

- Exact product source: `6ea83c8ec02c0fed24d05ca3902460b2dfd52584`, including
  the Vault config change `2d00300cbae5a166ba801650e8f5f3e478759161`.
- **466/466 units in 83 files passed**, including fresh-clone configuration,
  JSONC/external edits, masked token preservation/clearing, strict validation,
  Vault isolation and read/write identity changes, local Git remote backup,
  divergence preservation and runtime settings API coverage.
- Server and Web types passed. Fresh core, Web, Server and Windows desktop
  production builds and standalone server bundle guard passed.
- **2/2 actual bundled server integration tests passed**, then **2/2 repeated
  against the installed server bundle passed**, on disposable Vaults/data only.
  They verify fresh-clone bootstrap, masked settings, Git settings writes into
  git.jsonc, absence of global Git persistence, malformed config handling, native
  sync, existing watcher and dirty-editor protection.
- Actual packaged production SPA passed nine checkpoint groups in **6,893 ms**
  with **zero renderer errors**. The startup test's old six-button expectation
  was updated to include the previously delivered Properties panel. The first
  run had already passed seven groups with zero renderer errors before this
  stale expectation stopped it.
- A first full snapshot test attempt omitted required core dist builds; it is
  superseded by the successful run after building the exact snapshot's core.
  A workspace-only integration attempt also encountered another chat's
  unfinished sync-server dependency extraction; final validation used an
  isolated committed snapshot, without changing that owner's files.

## Actual configuration and first publication

- Created a new **private** personal Vault repository after explicit user
  authorization. Its URL and production token stay in private Vault config;
  no credential or private manifest was staged in the public application repo.
- Wrote enabled native sync with the existing ROG HTTPS route and 15-second
  polling, and enabled Git backup on main every 300 seconds, using local Git
  authentication and the already installed Git LFS.
- Native initial seed used the actual FileSyncEngine and active application's
  durable checkpoint. A temporary SSH forwarding connection accelerated
  transfer to the same ROG backend; persisted config retains the public HTTPS
  route. Its publication hook refused any incoming write to the local Vault.
- The public OrderedSyncTransport readback confirmed the original workspace
  identity, revision **1**, **6,448 files**, and **zero differences** from the
  acknowledged local baseline. No outbox or incoming apply remained.
- No existing note contents were rewritten. Added two connection files,
  `.gitignore`, `.gitattributes` and normal Git metadata. The ignored device
  Obsidian settings and retired history remain on disk.
- Initial Git commit contains **6,445 files**; the three native-only `.DS_Store`
  files are intentionally ignored by Git. Both the device backup branch and
  main now resolve remotely to `83c239f25b2b81bf1c38db412aa50326ac80fbd9`.
  A final actual Git backup call returned success for both pushes and a clean
  working tree, with no modified, staged, untracked or conflicted files.
- GitHub's API independently confirmed the repository is private, the remote
  tree contains **6,445 files / 386 Markdown notes / 160 PDFs**, and both
  connection files match the local bytes exactly. Native connection remains
  enabled at 15 seconds; Git backup remains enabled at 300 seconds with its
  optional Git token empty. Production native credentials were never printed.

## Windows delivery

- Windows **0.1.38** NSIS setup: **105,641,658 bytes**.
- Installed normally over 0.1.34 with exit code **0**. Actual EXE product
  version is **0.1.38.0**.
- Original desktop Vault configuration bytes are unchanged. No WebObsidian
  process was running before installation; the installer did not launch it.
- Repository root `server/public/index.html` size and UTC timestamp are
  unchanged. Concurrent independent server release files and the existing
  v0.1.37 draft are preserved.
- Published v0.1.38; tag resolves to the exact source commit above. All three
  assets are uploaded: setup 105,641,658 bytes, blockmap 110,422 bytes and
  BUILD-INFO.json 709 bytes. The v0.1.37 draft remains a draft.
- A scoped cleanup command for this task's Temp snapshot/archive was rejected
  before execution by automatic approval review (`blocked by policy`). It was
  not retried or bypassed. The isolated source/build copy remains in Temp;
  existing repository dependencies and other owners' artifacts are untouched.

## Boundaries

ROG native first publication and the initial GitHub LFS backup are verified.
The application will read the enabled shared configuration on next user start;
no live application session was opened. This task does not deploy clients or
alter retained divergent Vaults on the other devices, change gateway tasks,
restart Sakura/Tailscale, or claim physical multi-device UI acceptance.

Private recovery and receipts are under `.local/vault-connection-20261031/`;
the exact isolated build is under the task's Temp `.agents` directory.
