# Native application boundary

The owner retired all Web functionality on 2026-11-01. Supported application
targets are desktop (Windows/macOS/Linux) and Android. There is no browser
product, browser deployment/preview, Docker application image, embedded webpage
browser, userscript manager or browser-specific note navigation.

## Existing owners retained

The `web/` source directory is the shared native renderer. React, CodeMirror,
DOM, PDF workers, local iframe rendering/printing and Vite compilation remain
implementation tools of the native applications. Removing them would remove the
editor rather than retire a product target. No second native renderer is added.

Electron and Android retain their bundled loopback Node runtime. Files,
configuration, indexing, local HTTP/WebSocket messages, reviewed MCP operations,
native sync and optional Git backup keep their existing owners. The separately
released `sync-server/` remains a headless network service.

External hyperlinks in note content still delegate to the operating system.
This is a native content action; it does not reopen the application as a webpage.

## Deleted behavior

- Docker image/Compose/environment deployment and CI job; standalone renderer
  development/preview and server start scripts; development CORS/proxy path.
- Application note URLs, URL/history synchronization, copy-application-URL
  actions and the menu which opened a note in a browser window.
- Homepage webpage launcher, WebViewer view/commands/popup routing, guest
  preload/IPC, userscript settings/client/store/GM runtime/updater/network code.
- WebViewer-specific workspace mounting branches and styles.

Desktop and Android identify their native renderer with their existing HTTP
user-agent facility. Static application resources are available to those shells;
ordinary browser requests return 404. No SPA catch-all or note-URL route remains.
The marker is a product selection mechanism, not authentication. Existing
loopback/Vault/operation guards remain authoritative.

Restore discards retired WebViewer layout entries without touching the original
plugin/script files or stored script values. The legacy userscript plugin is
blocked by the existing plugin policy so it cannot recreate the removed core
feature. Unknown supported plugin views retain their existing lifecycle.

## Future work

Do not introduce browser fallbacks, browser deployment instructions, browser
compatibility targets or WebViewer adapters. Renderer tests may use Chromium as
an engine for DOM/editing contracts. Keep that evidence separate from native
window, Android device, physical IME/touch and live-Vault acceptance.
