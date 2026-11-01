# Personal local runtime

The owner explicitly approved replacing all session authentication with local
request checks on 2026-10-23. This fork is a personal application. Accounts,
passwords, sessions, API keys, the agent-key API, public shares and plugin downloads
are removed from the client, server and desktop launcher.

`server/src/middleware/localAccess.ts` owns the one access predicate. It requires
a loopback socket peer and a local Host. If Origin is supplied, it must be a local
HTTP(S) origin. Express applies it before all routes and static resources;
WebSocket upgrades call the same predicate. No forwarded header supplies the peer.
The application runtime binds to 127.0.0.1. Browser/Docker deployment was removed
on 2026-11-01. Native renderer assets require the desktop/Android shell marker and
have no note-URL or SPA fallback. See native-only.md.

The desktop directly opens its local server, without generating installation
passwords, logging in, or seeding cookies. Old on-disk configuration is not edited
by this source change. Future normal settings saves omit the removed schema
fields; notes, Vault configuration, plugin data and existing desktop preferences
are preserved by their original services.

File path containment, Vault maintenance leases, dirty-client coordination,
DocumentSession history, base revisions and attachment preview tokens retain
their original owners. Attachment cleanup retains its random, expiring preview
token and explicit selection, with one local operation owner instead of a hash
of a removed session credential. Installed plugin data, assets and enablement
remain available; the install route and GitHub download implementation are gone.

Source and diff inspection only. No tests, type checks, builds, servers, apps,
browsers, runtime migration or acceptance were run for this revision. Older
acceptance sources that exercise removed login/share routes are historical and
were not rewritten or executed.
