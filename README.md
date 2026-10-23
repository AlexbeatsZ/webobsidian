<div align="center">

<img src="assets/logo.png" alt="WebObsidian logo" width="140" />

# WebObsidian

**A self-hosted, Obsidian-compatible web app for your Markdown "second brain".**

Point it at a folder of Markdown files and edit your notes from any browser — with a
CodeMirror editor, live preview, wikilinks, an interactive graph, full-text search,
GitHub sync (incl. Git LFS), and support for installed community plugins.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](https://www.docker.com)

[Quick start](#-quick-start-docker) · [Features](#-features) · [Configuration](#-configuration) · [Development](#-local-development) · [Architecture](#-architecture)

> 📐 Design: [PRD.md](PRD.md) · 📋 Progress: [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)

</div>

---

## Direction of this fork

This fork aims to rebuild an Obsidian-like application around the owner's personal
workflows. The motivation is that Obsidian plugins offer limited control over the
host application. Owning the source allows direct changes to the editor, workspace,
file operations, and interface when plugin hooks are insufficient.

WebObsidian provides the existing implementation base. Its browser, self-hosted, and
desktop modes remain available; future work prioritizes concrete customization needs.
[obsidian-typings](https://github.com/obsidian-typings/obsidian-typings) is a reference
for undocumented APIs and compatibility analysis, not a complete Obsidian runtime.
Community-plugin compatibility is selective and must be verified per workflow.

See [project direction and reference boundaries](docs/design/product-direction.md)
for the rationale, current implementation gaps, and proposed next steps.

The plugin host now connects commands, settings, vault data, CM6 extensions and
Markdown renderers to the application. It reads existing vault plugin enablement
and settings without migrating the source vault. Native Node/Electron plugins
require the desktop File menu's **Trust native plugins (next launch)** setting,
which is off by default. See the [tested plugin versions, setup and remaining
acceptance boundaries](docs/design/plugin-compatibility.md). Final interactive
acceptance is reserved for the owner; API presence alone is not full compatibility.

## Rendering and source preservation

Live editing, Reading, split panes, embedded notes, table cells and Canvas Markdown
reuse one CodeMirror presentation engine. Views get
an explicit document context; the workspace owns sessions, saves and permissions.
Unchanged source keeps its BOM, mixed line endings, whitespace and quoting.
Table/property edits patch ranges instead of serializing the whole structure.
Print/PDF freezes an entire readonly rendering after resources load.

See [rendering design, acceptance and limits](docs/design/rendering-unification.md).
Automated checks: npm run test:unit, npm run test:render, npm run test:integration.
The browser suites accept RENDER_TEST_BROWSER for an installed Chromium executable.
Native IME/touch and system print-dialog acceptance remain manual.

## What is this?

WebObsidian is a web application that gives you an [Obsidian](https://obsidian.md)-like
experience over a **real folder of Markdown files** living on your server. It works
with existing Obsidian vault files. Compatibility with `.obsidian/` settings, themes,
and plugins depends on the specific feature; preserving these files does not mean
every Obsidian behavior is implemented.

This personal fork runs on the local machine. HTTP and WebSocket requests use one
loopback peer, Host and Origin check. Accounts, sessions, API keys and public sharing
have been removed. Application configuration lives in `data/settings.json`;
advanced feature configuration belongs to the selected Vault.

> **Why?** To own and customize the editor and workspace around personal notes.

---

## ✨ Features

- 📝 **Editor & rendering** — CodeMirror 6 with live / source / reading views; wikilinks
  `[[note]]`, embeds `![[file]]`, tags `#tag`, callouts, task lists, MathJax 4.1.3 math and
  Mermaid diagrams.
- 🕸️ **Graph view** — force-directed graph built from your wikilinks, with fly-to node
  search and highlighting.
- 🔗 **Backlinks & outline** — right sidebar tab strip: Backlinks (linked **and** unlinked
  mentions), Outgoing links (resolved/unresolved), Tags and Outline.
- 🔍 **QMD search** — fast full-text + fielded search (`tag:`, `path:`, `title:`), fuzzy +
  prefix matching, incremental indexing, persisted to disk for fast startup.
- 🔄 **GitHub sync** — native `git` pull / commit / push with **Git LFS** for large
  attachments, optional auto-sync, and per-file **version history** (browse & restore).
- 🧩 **Community plugins** — use already installed Obsidian plugins through the
  existing compatibility host; enable or disable them in Settings.
- 📱 **Responsive / mobile** — drawer sidebars, edge-swipe, an on-keyboard formatting
  toolbar, and touch-friendly targets, à la Obsidian Mobile.
- 🗃️ **Pure-JSON config** — everything lives in `data/settings.json`. No database.
- 🐳 **Docker** — one command to run the whole stack.

---

## 🚀 Quick start (Docker)

```bash
git clone https://github.com/AlexbeatsZ/webobsidian.git
cd webobsidian
cp .env.example .env          # edit VAULT_HOST_PATH
docker compose up -d --build
# open http://localhost:8787
```

Out of the box it serves the bundled `./sample-vault`, so the stack boots immediately. All
deployment settings live in **`.env`** (git-ignored) — you never edit the tracked
`docker-compose.yml`, so a `git pull` / redeploy keeps your config and vault mapping intact.

## 🖥️ Desktop app (no server setup)

Prefer a native app? Download a desktop package from the
[**Releases**](https://github.com/AlexbeatsZ/webobsidian/releases) page — available for
**macOS / Windows / Linux** (Windows: x64 portable; macOS/Linux: arm64 and x64):

| Platform | Download |
|----------|----------|
| macOS    | `.dmg` (or `.zip`) — arm64 / x64 |
| Windows  | Portable `.exe` — x64 |
| Linux    | `.AppImage` or `.deb` — x64 / arm64 |

The desktop app bundles the whole server, picks your vault folder on first launch, and
**opens the local application directly** — no account or Docker required. Apps are currently
**unsigned**, so macOS Gatekeeper / Windows SmartScreen will warn on first open (right-click →
Open on macOS). Build it yourself with `npm run desktop:dist`; see
[`desktop/README.md`](desktop/README.md) for details.

### Point it at your own vault

```bash
# .env
VAULT_HOST_PATH=/abs/path/to/your/ObsidianVault   # must exist; bind-mounted to /vault
HTTP_BIND=0.0.0.0                                  # 127.0.0.1 to expose only to localhost
HTTP_PORT=8787
```

Then `docker compose up -d --build`. Your vault can be a plain folder or a `git clone`
(Git LFS is supported for attachments).

### Behind a reverse proxy (TLS)

Set `HTTP_BIND=127.0.0.1` so the app is only reachable from the host, then terminate TLS
with nginx / Caddy / Traefik in front of `http://127.0.0.1:8787`.

### Large vaults & file watching

A fresh VPS ships a low `fs.inotify.max_user_watches` (often 8192), which a big vault
exceeds. WebObsidian auto-detects this and falls back to **polling** (works anywhere,
higher CPU). For lower CPU, raise the kernel limit and keep native watching:

```bash
sudo sysctl -w fs.inotify.max_user_watches=524288
echo 'fs.inotify.max_user_watches=524288' | sudo tee -a /etc/sysctl.conf
```

The search index (QMD) and link graph are kept in memory, so memory use scales with the
number of notes. The Docker image sets `NODE_OPTIONS=--max-old-space-size=4096` (4 GB);
raise it to `8192` for very large vaults (e.g. 6k+ notes / multi-GB).

---

## 💻 Local development

Requires **Node ≥ 20** and `git` (+ `git-lfs` if you use LFS).

```bash
npm install
npm run dev          # server on :8787 + web dev server on :5173 (proxied)
# open http://localhost:5173
```

Production build (the server serves the built SPA):

```bash
npm run build
VAULT_PATH=./sample-vault npm start
# open http://localhost:8787
```

Useful scripts:

| Command | What it does |
|---------|--------------|
| `npm run dev` | Run server + web together in watch mode |
| `npm run build` | Build the web SPA, then compile the server |
| `npm start` | Run the production server (serves built web) |
| `npm run typecheck` | Type-check both workspaces |

---

## ⚙️ Configuration

### Docker env (`.env`, consumed by `docker-compose.yml`)

| Var | Default | Description |
|-----|---------|-------------|
| `VAULT_HOST_PATH` | `./sample-vault` | Host path bind-mounted to `/vault` |
| `HOST` | `127.0.0.1` | Local listener; Compose uses host networking |
| `WEBOBSIDIAN_WATCH` | `auto` | `auto` (native + polling fallback) or `polling` |

### App-level env (read by the server; Docker sets these inside the container)

| Var | Default | Description |
|-----|---------|-------------|
| `PORT` | `8787` | HTTP port |
| `VAULT_PATH` | `./sample-vault` | Path to the notes vault |
| `DATA_DIR` | `./data` | Where `settings.json` + search index live |
| `ALLOWED_ROOTS` | – | Comma-separated roots the vault picker may browse |
| `WEBOBSIDIAN_WATCH` | `auto` | File-watch mode: `auto` or `polling` |
| `NODE_OPTIONS` | `--max-old-space-size=4096` | Node heap size — raise for large vaults |

Git remote/token, plugin enablement and theme use the existing Settings services.
Advanced scripts, menus, snippets and formulas use Vault-owned configuration files.

---

## 🏗️ Architecture

Monorepo with two npm workspaces:

```
webobsidian/
├── server/   # Express + TypeScript API
│   └── src/{routes,services,middleware,plugins}
├── web/      # React + Vite SPA (built into server/public)
│   └── src/{components,lib,styles}
├── data/     # runtime: settings.json + search index (git-ignored)
├── docs/     # module design and Obsidian internals notes
├── Dockerfile · docker-compose.yml · .env.example
```

```
┌──────────────────────── Browser (React SPA) ────────────────────────┐
│   CodeMirror 6 · Live Preview · File Tree · Graph · Search           │
└───────────────▲──────────────────────────────────┬──────────────────┘
                │ REST + WebSocket                  │ static assets
┌───────────────┴──────────────────────────────────▼──────────────────┐
│                  Server (Node + Express + TypeScript)                │
│   Auth gate │ Vault FS │ QMD Search │ Git Sync │ API Gate │ Plugins  │
└──────┬──────────────┬───────────┬────────────┬───────────────┬───────┘
   settings.json   Vault dir   Search index  GitHub repo    plugins dir
   (JSON config)   (.md+attach) (in-mem/disk) (git + LFS)   (.obsidian/plugins)
```

**Tech stack:** Node 20+ · Express · TypeScript · React · Vite · CodeMirror 6 ·
unified/remark/rehype · MiniSearch (QMD) · simple-git + git-lfs · Docker.

See [PRD.md §2](PRD.md) for the full design.

---

## Local access

The server accepts loopback peers with a local Host and, when supplied, a local
HTTP(S) Origin. WebSocket upgrades use the same predicate. There are no login,
API-key or public-share endpoints. File path and Vault mutation/revision guards
remain in their original services. See [personal local runtime](docs/design/personal-local-runtime.md).

Compose uses host networking so the same loopback rule applies; a normal
bridge-published port is not a supported access path. This deployment path has
not been exercised for this source revision.

---

## 🗺️ Compatibility & scope

- ✅ Works directly on an existing Obsidian vault, including `.obsidian/` config.
- ⚠️ **Single-user (v1)** — no real-time multi-user collaborative editing yet.
- ⚠️ Git sync replaces Obsidian Sync/Publish.
- ⚠️ Community-plugin support is a **subset** of the Obsidian API; plugins relying on
  Electron/Node internals may not work.

---

## 🤝 Contributing

Contributions are welcome! A few house rules from [CLAUDE.md](CLAUDE.md):

1. **Follow [PRD.md](PRD.md).** It is the source of truth for design. Changing scope means
   updating the PRD first (with a changelog bump), then the code.
2. **Keep [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) in sync** — flip checkboxes and
   add a progress-log line as you work.
3. TypeScript everywhere; avoid `any`. Runtime config is JSON only (no DB engine).
4. Never log secrets/tokens; hash before storing; guard against path traversal.

Run `npm run typecheck` before opening a PR.

---

## 📄 License

[MIT](LICENSE) © xnohat

---

<div align="center">
<sub>Built for people who want to own their notes. Not affiliated with Obsidian.md.</sub>
</div>
