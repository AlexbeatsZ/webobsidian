# Native host lifecycle

## Owners and shared contracts

Server owns settings schema, Vault validation, indexing, HTTP/WS and operations endpoint publication. Desktop ServerProcess owns its child and bounded shutdown. Android RuntimeHost owns one embedded Node invocation per application process. Renderer platform.ts is the one native identity adapter. host.ts supplies export, clipboard, close and Back capabilities. DesktopBridge defines preload and renderer types once. Plugin requestUrl always uses the existing server plugin-request route.

Responsive layout remains useIsMobile. Package metadata retains independent desktop and Android versions. Diagnostics read the actual host version, supplied through Electron arguments or the Android host UA token. Library workspace versions retain their existing package semantics.

## Startup and shutdown

Native hosts pass PORT=0 and JSON-encoded allowed roots. Server atomically publishes its bound URL/PID to operations-endpoint.starting.json during startup, then renames that same file to operations-endpoint.json only when ready. Existing endpoint consumers retain their readiness contract. Native hosts check either publication path. HTTP binds before indexing. healthz returns 503 and its PID while initializing, then 200 once the ordinary full index and watchers are ready. Other requests receive 503 during initialization. Hosts tolerate a responsive cold index and fail after two minutes without a response. A child exit fails promptly. External endpoint consumers validate local URL and PID, then confirm the same live health identity.

Desktop registers chrome handlers before loading and command/close handlers before any workspace navigation, even when the first loading window closed. macOS activation during initialization reopens the loading view. Native menus dispatch typed registered commands without claiming configurable editing accelerators. Renderer explicitly reports chrome state and close-handler readiness. Crashed or unresponsive pages offer an explicit discard decision, preserving the default save barrier for responsive pages. Runtime exits notify the user and retain the current renderer draft.

Quit stops Tunnel with TERM then KILL escalation, then sends the server an IPC shutdown message. SIGTERM, SIGINT and IPC disconnect share server shutdown. It stops accepting requests and watcher activity, drains file updates, waits for running auto-sync, flushes pending file sync and derived cache saves, removes its own endpoint and exits. A bounded host deadline prevents a hung child from trapping application exit. Interrupted sync already uses the existing persisted recovery/checkpoint scheme. OS process termination on Android can interrupt in-flight saves. DocumentSession autosave and background-save events remain the persistence owners.

## Android recovery and capabilities

Java no longer parses settings.json. The server validates the selected/persisted Vault before creating directories when WEBOBSIDIAN_REQUIRE_VAULT=1. The selection UI remains reachable on startup failure. Embedded startup failures publish a PID-scoped failure in the startup endpoint and retain the process for recovery, avoiding process.exit terminating the Android Activity. Failures before entering Node can retry in-process. Once Node has run, explicit retry/selection launches an unexported RecoveryActivity in a temporary recovery process, which records a one-shot private choice, ends the old process and relaunches MainActivity. No app data clearing or application identity change occurs. WebView renderer loss exposes reload and selection actions. Runtime exit while editing offers restart with an unsaved-edit warning and an option to keep the page.

Each packaging invocation generates runtime-id.txt. A complete private runtime directory is selected by that ID, refreshing same-version rebuilds. Incomplete copies are retried and obsolete runtime-* directories removed. Vault/server-data/log directories are outside extraction. JNI converts UTF-16 to standard UTF-8 including supplementary characters. Desktop writes and the Android native pipe reader rotate live logs at 4 MiB, retaining one previous log.

A WebMessagePort is transferred to the exact local top-level origin after page load. It supports foreground clipboard reads and exports through ACTION_CREATE_DOCUMENT. Export bytes remain in memory only until the picker completes, with a 24 MiB limit and one active picker. It exposes no arbitrary path writer. Graph PNG, debug JSONL and menu JSON exports use host.download. Android Back sends a cancelable renderer event. Existing dialog/image/plugin-modal lifetimes register a dismiss action, palette/move picker and drawers use their owning state. Busy dialogs keep their existing cancellation rules. Android 13+ uses OnBackInvokedDispatcher and older versions retain onBackPressed.

## Review dispositions

The original review item about duplicate background save writes is guarded by DocumentSession's existing coalesced writer and raw-content equality check. Renderer also coalesces simultaneous lifecycle saves. Linux remains a supported desktop target. The lack of an online Linux deployment target does not authorize removing its packages. Build-time hash tables remain compatibility/download verification data.

## Verification

Regression tests must cover real server PORT=0 discovery, pre-index readiness, graceful IPC/signal exit, endpoint removal, missing Vault preservation, supplementary/comma paths, desktop splash close/reopen, failed renderer close and shared Back/export behavior. Builds and device acceptance are recorded separately in tests/reports/host-lifecycle-20261113.md.
