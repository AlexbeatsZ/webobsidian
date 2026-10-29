# Native file sync and Git backup

## Ownership and transport

Native HTTPS file transport owns live Markdown, Canvas and binary attachments, not Git.
DocumentSession retains local saving/history, textFile owns physical publication, and
the existing watcher/fileupdates owns indexing and notifications. No second watcher,
editor, parser or index is introduced. Git is only periodic backup and conflict history.

Each Vault stores its enabled flag, ordered addresses, token and interval in
`.obsidian/webobsidian/sync.jsonc`. The existing Vault configuration reader/JSONC parser
and revision-checked physical writer are authoritative; application settings contain no
second copy or implicit import. Git backup explicitly includes this one file even if
`.obsidian` is ignored, so cloning a private Vault repository bootstraps native transport.
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

## Validation boundary

Use temporary Vaults for all protocol, binary, failover, offline, retry, conflict and
recovery tests. Source/build checks are not live Sakura, physical device or deployed
client acceptance. Installing a ROG startup task or changing its shared gateway requires
explicit approval; preserve the existing task XML and do not restart SakuraFrpService.
