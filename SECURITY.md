# Security policy

Report vulnerabilities privately through this fork's GitHub Security Advisories.
Include the affected application version, a description and reproduction steps;
do not publish Vault content or credentials in an issue.

## Runtime boundary

The client is a personal desktop/Android application. Its bundled runtime binds
to loopback; HTTP and WebSocket share the existing local peer/Host/Origin predicate.
Native renderer assets require the native shell's user-agent marker. This marker
selects the supported renderer, and is not an authentication secret. Accounts,
passwords, session tokens, API keys and public-share endpoints are absent.

File containment, Vault identity, maintenance leases, document revisions and
local review remain the owners of file-operation safety. Plugin Node access is
an explicit desktop trust choice. Keep notes, native profile/configuration and
sync credentials out of Git. The independently released sync server has its own
authenticated protocol and does not expose the application interface.

Supported fixes target the current native application release. Browser deployment,
reverse proxies and remote note-editing pages are outside the product.
