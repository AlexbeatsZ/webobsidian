# Native file sync and Git backup

## Ownership and transport

Native HTTPS file transport owns live Markdown, Canvas and binary attachments, not Git.
DocumentSession retains local saving/history, textFile owns physical publication, and
the existing watcher/fileupdates owns indexing and notifications. No second watcher,
editor, parser or index is introduced. Git is only periodic backup and conflict history.

Each Vault stores its enabled flag, ordered addresses, token and interval in
`.obsidian/webobsidian/sync.jsonc`. The existing Vault configuration reader/JSONC parser
and revision-checked physical writer are authoritative; application settings contain no
second copy or implicit import. The file carries the access token, so Git backup never
records it (see Vault Git configuration); native transport itself replicates it between
the user's synchronized devices. A fresh clone enters the connection once in settings.
Only local checkpoint/outbox/incoming journals, caches and recovery files stay in the
device's application data directory. Every pass starts at entry one; attempts are sequential.
No direct/public categories, probing races, speed ranking or last-success promotion.
Use the first available address for that pass. On transport failure, retry the durable
operation later, starting at entry one. Authentication, identity, rollback and conflict
errors stop rather than silently switching data authorities. All addresses must expose
the same immutable workspace identity. HTTP is allowed only for private/loopback IPs;
public connections require certificate-verified HTTPS. Redirects are not followed.

The optional Sakura Web route is /webobsidian-sync/v1/, separate from Dayweave,
Mojian and subscriptions. No extra tunnel is required. Backend credentials/data are
independent. Existing services/tasks and live Vaults are never implicitly changed.

The standalone server is versioned and released independently with `sync-server-v*`
tags. Its thin `createSyncServer` adapter delegates durable storage, streaming blobs,
CAS, receipts and draining close to an exact-release-pinned `@alexbeatsz/file-sync-core`.
`protocol.mjs` remains the WebObsidian path/manifest authority and the adapter retains
printable ASCII 32–512 token policy plus Origin/query/fragment rejection. Existing
gateway exports, 18744 port, v1 route, receipt fingerprints and storage layout remain
compatible. No second storage kernel is maintained in this repository. The tested core
and license/notices ship inside each server package; Node 22+ needs no runtime install
or sibling source checkout. `core-source.json` and `BUILD-INFO.json` record provenance.
Server releases never change desktop/mobile versions or the client's latest Release.

## Personal deployment

The user's deployment requires only
`http://100.106.169.46:18744/webobsidian-sync/v1/` in each device's connection
list as of 2026-11-14. The ROG service binds its Tailscale IPv4 address through its
existing `server.json` and `WebObsidianNativeSync` task. The production workspace is
`76fcca29-885b-4dd1-832e-cfac4f07cc09`. This deployment uses the existing
endpoint model.

## Files and safety

Reuse Mojian's immutable SHA-256 blobs, exact-version CAS, retained tombstones and
idempotent operation receipts. Uploads/downloads stream to disk, never decode attachments
as text. Local metadata signatures reuse staged blobs on restart; existing watcher
events identify dirty paths, which are rehashed even if timestamps are unchanged.
Idle passes do not walk the Vault again. Restart scans durable files once. Renames are an atomic
manifest addition/deletion; identical blob content is reused. Empty directories are not
synchronized. Case-only aliases and file/directory shape conflicts stop for explicit
handling instead of deleting existing directories. Per-file limit is 1 GiB. Server
history/blobs/receipts have no automatic GC.

Only .obsidian/webobsidian is included from .obsidian; plugin state, workspace layouts,
.git, .trash, Syncthing metadata and temporary files are excluded. Application sync
credentials intentionally travel with the Vault configuration: use a private Vault
repository and grant access only to trusted devices. General settings and connection
responses never expose the plaintext token; the dedicated password field returns a mask.
User-authored files are not scanned for secrets. Reject
links and Syncthing-managed roots instead of enabling two file writers over one library.
No automatic live-Vault selection, migration or seed choice. Configured Vault files
propagate through the same native file transport; no separate configuration channel.

Three-way comparison uses local bytes, acknowledged baseline and remote manifest.
Persist staged outgoing blobs and one stable operation before submission; uncertain
commits retry the same ID. Incoming blobs are verified before an on-disk apply journal
is written. The existing maintenance gate blocks dirty editor/Canvas sessions during
publication, while the shared physical writer uses binary CAS.
Notifications produced during maintenance are released only after the existing client
lease is released, so refreshed documents never read a partially published pass.
Read-only plugin adapter operations share one operation predicate with the server
gate and browser request accounting; an adapter read arriving during maintenance waits
for release and then checks Vault identity. Adapter writes remain rejected, and unrelated
request/identity guards retain their existing behavior.
Restart recovery replays
the local journal before opening an editable library when enabled. Disabling sync keeps
the journal but does not replay it. Recovery errors remain visible without preventing
the application from opening. This is per-file crash recovery,
not an all-files filesystem transaction or simultaneous handwriting merge.

Conflicts never choose newest timestamp or insert markers into working notes. Retain
both exact binary/text versions plus deletion metadata in local recovery storage. When
Git backup is enabled, additionally record local/remote snapshots on separate branches
without switching the working branch or changing its index. Binary conflicts need an
explicit version choice. Native sync disables per-save Git commits and background Git
pull; the existing Git timer instead commits periodically and optionally pushes backups
to per-device webobsidian-backups branches, together with retained conflict branches.
It also attempts a normal non-forced push to the configured repository branch, making
the shared connection discoverable by a fresh clone. If that branch has diverged or
rejects the update, the successful device backup remains available; never pull, merge,
force-push or overwrite the other device's repository history to make this succeed.
Manual pull/clone is blocked while native synchronization owns file transport.

## Server-side Git backup (sync-server)

Direction (user, 2026-11-02): the always-on sync server is the single Git backup writer;
client Git is removed in a later step after the server backup is live. The server's
manifest is the merged authoritative state and each revision is an atomic snapshot, so
history is linear and never captures a half-edited working tree.

`sync-server/backup.mjs` runs inside the server process (opt-in `backup` config object)
and as `--backup-once` / `--backup-dry-run` CLI modes. It never changes sync data: it reads
`state.json` (renamed atomically by the core) and immutable `blobs/<sha256>` files.
The backup repository is a separate non-bare Git directory whose work tree holds only the
snapshot's `.gitignore`/`.gitattributes` files. Git itself decides ignore and LFS rules
(`check-ignore --no-index`, `check-attr filter`, `core.ignorecase=true` like the Windows
clients), so no gitignore/attribute matcher is reimplemented. Connection files
(`sync.jsonc`, `git.jsonc`) are always excluded. LFS entries become standard spec-v1
pointers; the sync hash is already the LFS SHA-256 oid, so the blob is hard-linked (copy
fallback) into `.git/lfs/objects` and nothing is re-hashed. Regular files are written
with `hash-object -w` under `core.autocrlf=true`: the existing history was committed by
Windows clients with that system default, so CRLF text is stored as LF (sync keeps the raw
bytes). With raw bytes, a real STEM dry run reported hundreds of modified SVGs; with
normalization it matched `3b3f1cc` exactly (6445 files, 5573 LFS, 0 changes). A
temporary index builds the tree; an unchanged tree
creates no commit. The first run fetches the remote branch and continues its history;
later runs commit on the local branch, `git lfs push`, then a normal non-forced push.
A rejected push stops with an error and is retried next interval; never force, pull into
data or merge. One lock file serializes runs. Credentials come from the host's Git
credential helper (`GIT_TERMINAL_PROMPT=0`), never from configuration.

## Vault Git configuration

Git backup settings now belong to `.obsidian/webobsidian/git.jsonc`: enabled,
remote, branch, optional token, authorName, authorEmail, autoSync,
autoCommitOnSave, intervalSec and lfsPatterns. The existing settings UI/API reads
and writes this file through the same Vault configuration reader and
revision-checked writer as sync.jsonc. Git operations, the periodic timer and
conflict history read this one authority; application-global `settings.json.git`
is no longer used. A fresh Vault defaults to Git disabled. Existing legacy
settings bytes are not silently imported or assigned to a different Vault.

Both connection files can hold tokens, so Git backup excludes them: each commit
writes `/.obsidian/webobsidian/sync.jsonc` and `/.obsidian/webobsidian/git.jsonc`
to the repository's `.git/info/exclude` and untracks copies committed by earlier
versions (`git rm --cached`, working files stay). Conflict branches skip them too.
No token is stored in Git history or encrypted; the files stay plain device/Vault
data. Tokens are masked in API responses. Leave the Git token empty to use
the device's existing Git credential helper. Git configuration is read by Git/API operations, not every editor
input or ordinary application-settings read.

Git LFS progress is explicitly enabled for the existing child process. The
120-second no-output timeout still detects a stalled command without aborting a
healthy first backup simply because LFS suppressed progress on piped stdout.

## Validation boundary

Use temporary Vaults for all protocol, binary, failover, offline, retry, conflict and
recovery tests. Source/build checks are not live Sakura, physical device or deployed
client acceptance. Installing a ROG startup task or changing its shared gateway requires
explicit approval; preserve the existing task XML and do not restart SakuraFrpService.
