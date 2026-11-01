<div align="center">
<img src="assets/logo.png" alt="WebObsidian logo" width="140" />

# WebObsidian

**A personal Markdown application for desktop and Android.**

[MIT license](LICENSE) · [Releases](https://github.com/AlexbeatsZ/webobsidian/releases) · [Desktop](desktop/README.md) · [Android](docs/design/android-runtime.md)
</div>

## Product scope

This fork rebuilds an Obsidian-like application around the owner's editing and
reading workflows. Windows, macOS, Linux and Android are application targets.
There is no browser edition, self-hosted webpage deployment, embedded webpage
browser or userscript manager. Future changes target the native applications.

The `web/` workspace contains the shared React/CodeMirror renderer embedded by
Electron and Android WebView. The `server/` workspace is their bundled loopback
runtime for files, indexing, configuration and document operations. These are
internal application components. They are not independently supported products.
The application runtime binds to `127.0.0.1`; renderer assets are served only to
the native shells, without browser note URLs or history routing.

## Install

Download an application package from [Releases](https://github.com/AlexbeatsZ/webobsidian/releases).

| Target | Package |
| --- | --- |
| Windows | x64 per-user setup `.exe` |
| macOS | arm64 / x64 `.dmg` or `.zip` |
| Linux | arm64 / x64 `.AppImage` or `.deb` |
| Android | `.apk` |

Choose a Vault using the application's folder picker. Notes, attachments and
Vault configuration remain ordinary files. Updating the application does not
require moving or rewriting the Vault. See [desktop packaging](desktop/README.md)
and [Android runtime](docs/design/android-runtime.md).

## Editing and reading

- Markdown Live Preview, Source and Reading views share CodeMirror source analysis
  and document sessions, including split panes, sidebar notes and embedded notes.
- Wikilinks, stable content references, backlinks, outlines, graph view, tags,
  source-preserving tables/properties, MathJax formulas and Pele diagrams.
- Native PDF reading, thumbnails, outline and Markdown minimap.
- Vault-owned snippets, writing/formatting rules, templates, commands and menus.
- Existing installed community plugins use the shared compatibility host.
  Compatibility is selective; native Node/Electron plugin access is a separate
  desktop trust setting. Original plugin files and settings are preserved.
- File sync, optional Git backup and reviewed local AI proposals use their existing
  services and document save barriers.

## Sync and AI tools

The [independent sync server](sync-server/README.md) is a separate headless
application. It remains available for device synchronization and does not serve a
note-editing webpage. Keep its deployment and data separate from the native client.

The desktop **MCP** panel configures and connects the bundled MCP/Tunnel runtime.
It shares the existing operation dispatcher with stdio MCP and the developer CLI.
The application reviews edit/create/rename proposals locally before writing files.
See [MCP operations and review](docs/design/native-mcp.md).

## Build and development

Requires Node.js >=20, npm and Git. Android also requires its documented Android
SDK/JDK toolchain. Install dependencies inside this project:

```bash
npm ci
npm run dev                 # build and launch the native desktop application
npm run desktop:dist        # build native desktop deliverables
npm run typecheck
npm --workspace desktop run typecheck
npm run test:unit
```

`npm run build` compiles the shared renderer and local runtime for the native
packagers. It does not start a browser application. Renderer regression fixtures
may use headless Chromium as a test engine; this does not add a browser product or
browser compatibility target. Native IME/touch/window/system-print acceptance is
separate from those checks. Use an isolated source snapshot for production builds
when the checkout's generated resources are used by a running application.

## Architecture and design

| Component | Owner |
| --- | --- |
| `desktop/` | Electron windows, native menus, local runtime and MCP lifecycle |
| `android/` | Android storage selection, embedded Node runtime and WebView lifecycle |
| `web/` | Shared native renderer, document sessions, commands and plugin adapters |
| `server/` | Loopback file/configuration/indexing/operation services |
| `sync-server/` | Independently released headless device sync |
| `packages/markdown-core/`, `packages/search-core/` | Shared pure source and search contracts |

Document text/history/save belong to DocumentSession; syntax/ranges to
markdown-core; saved metadata to VaultCatalog. Existing command, menu and rendering
owners remain authoritative. Do not introduce a browser fallback or a parallel
implementation for plugins.

[Product direction](docs/design/product-direction.md) ·
[Native application boundary](docs/design/native-only.md) ·
[Local runtime](docs/design/personal-local-runtime.md) ·
[Plugin compatibility](docs/design/plugin-compatibility.md) ·
[PRD](PRD.md)

## License

[MIT](LICENSE). Based on xnohat/webobsidian. Not affiliated with Obsidian.md.
