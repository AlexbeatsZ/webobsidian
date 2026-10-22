# Native browser scripts, menus, attachment cleanup and tags

## Goal and accepted constraints (2026-10-22)

Integrate four personal workflows into the application, removing duplicate plugin
implementations where the migrated functionality overlaps. The user explicitly
requested multiple Codex chats to implement this plan. The coordinator owns shared
application integration; feature chats own the modules listed below.

Validation remains static only: TypeScript and isolated bundles. Do not start a
browser, Electron, development server, unit/HTTP/UI acceptance suite, or the running
application. Do not edit the real Vault. Read legacy configuration from the
disposable `.local/test-vault`; preserve original configuration and plugin sources.
No new desktop package is requested. Keep `server/public` and existing releases.

## Existing implementation and reuse decisions

| Workflow | Existing implementation | Native integration decision |
| --- | --- | --- |
| Browser scripts | `obsidian/webviewer.ts`, Electron guest restrictions, local `obsidian-webviewer-userscripts` source | One managed script store and updater; run scripts in the existing isolated guest, sharing navigation and guest lifecycle. Import `.user.js` URLs and files; preserve per-script settings/storage during updates. |
| Context menus | Store `ContextMenuItem`, React `ContextMenu`, Obsidian `Menu`, `extendFileMenu`; Plus menu capture; Nilesoft `shell.nss` with imports/rules | One declarative configuration transforms the actual menu model after built-in/plugin contributions. Stable IDs, explicit contexts, conditional visibility, rename/hide/order/groups/submenus and command actions. Reuse renderers and command execution. No global DOM observer or arbitrary configuration evaluation. |
| Unused attachments | `VaultCatalog`, `TargetIndex`, link graph, serialized file-update queue, `vault.trash`; Plus unused-images module | Broaden from images to supported attachments. Reuse all-file resolution and catalog membership; collect Markdown, embeds, frontmatter, HTML/CSS and Canvas references conservatively. Scan/preview first; revalidate before trash; discovery errors or ambiguous state must never become deletion permission. |
| Tags | Catalog note tags/aliases, shared Markdown source/property tools, `TagsPanel`, search; Plus Multi Tag and Tag Wrangler | Native tag hierarchy/counts/search, batch add/remove, hierarchy rename with merge confirmation, drag/drop and Tag Pages. Reuse saved catalog, unsaved document/session handling and source-range edits; preserve unrelated YAML and line endings. |

The catalog and existing file-update pipeline continue owning saved metadata and
invalidation. Do not create another Vault watcher, full-body cache, search engine,
command registry, menu capture registry, plugin runtime or general extension host.
Add private caches only when they avoid concrete repeated work and share the
existing invalidation generation. Maintenance commands may scan on demand where
correctness requires current content; never do that work on keystrokes/menu opens.

## Chat ownership and integration seam

All feature chats use the existing local checkout, as requested. Other active work
(native writing, LaTeX Suite/Linter) already modifies shared files. Never revert,
stage, format or overwrite another task's changes. Do not use `git add .`.

1. **Browser userscripts** owns new userscript-specific files under `desktop`,
   `server`, `web`, `docs/design/browser-userscripts.md`; may edit only
   `desktop/src/main.ts`, `desktop/src/preload.ts` and
   `web/src/lib/obsidian/webviewer.ts` among existing shared modules.
2. **Configured menus** owns menu-specific new modules and design document,
   `web/src/components/ContextMenu.tsx`, `web/src/lib/obsidian/menus.ts` and
   `web/src/lib/obsidian/ui.ts`. UI model conversion must retain IDs, disabled
   state and callbacks.
3. **Attachment cleanup** owns attachment-specific new modules/routes/UI/commands
   and `docs/design/attachment-cleanup.md`. Does not change catalog or graph
   semantics to make attachment resolution work.
4. **Native tags** owns tag-specific new modules/routes/UI/commands,
   `web/src/components/TagsPanel.tsx`, and `docs/design/native-tags.md`.

The coordinator alone edits shared `App.tsx`, `Settings.tsx`, `Editor.tsx`,
`MarkdownView.tsx`, file/tab menu callers, `api.ts`, `store.ts`, `nativeCommands.ts`,
`obsidian/runtime.ts`, plugin loading, server startup/settings/routes index,
catalog/index/Markdown-core exports, workspace package manifests/locks and root
project documents. Feature chats request these changes in
`.local/feature-integration/<feature>/integration.md`; include exact exports,
signatures, initialization/disposal, routing/authentication and event requirements.
Avoid speculative frameworks. Reuse the existing HTTP request/error handling
patterns. Feature command arrays are aggregated by the existing native command
registry; plugin adapters delegate to it.

Each feature chat implements its own module, performs available static checks and
records outstanding integration precisely. The coordinator reviews and applies
integration, runs final static checks, commits only relevant changes and pushes to
the user's origin. Feature chats must not commit concurrently. Root `AGENTS.md`
and `docs/log` remain excluded because this is a third-party fork.

## Execution and acceptance sequence

1. Inventory exact source versions and relevant legacy settings; record each
   migrated behavior, exclusions and compatibility claims in feature documents.
2. Implement the four independent modules in separate chats; report shared edits.
3. Integrate shared settings, commands, routes, events and legacy-module
   suppression once, preserving unrelated Plus modules and the native-writing work.
4. Review deletion/reference safety, tag source preservation, script update/storage
   lifecycle and menu reload semantics. Imported menu configurations must take
   effect without stale references or application restart.
5. Run TypeScript and isolated production/standalone bundle checks. Regression
   fixtures may be authored, but remain unexecuted under the static-only rule.
6. Commit/push scoped changes. Report code/build evidence separately from user UI,
   IME, navigation, script compatibility, actual Vault correctness and performance
   acceptance. Do not claim measured speedup from structural improvements alone.

## Status

- Implementation and shared integration completed on 2026-10-22. Four implementation
  chats and the integration chat used the existing checkout; ignored local ledgers
  retain their provenance. Feature code does not contain chat IDs.
- App initializes/disposes script and menu clients after authentication. Settings,
  the existing command manager, menu renderers, file/tab/search callers, render
  contexts and server routes own the entry points. Menus capture paths, extensions,
  selection/version, link/tag and modifiers. There is no per-menu configuration IO.
- `/api/native-features` persists per-Vault tag preferences and attachment exclusions.
  Initial tag import preserves Plus data. Cleanup loads exclusions when opened;
  saving them is separate from scanning. Completion derives saved tag choices once
  per existing frontend catalog snapshot, without full-summary requests on input.
- Cleanup's short-lived lease drains HTTP/background Git writes and existing file
  updates, inspects authenticated application sockets and freezes input during
  revalidation/trash. Dirty/conflict/saving sessions, pending Canvas edits, native
  direct-filesystem plugin mode and unknown/disconnected clients block execution.
  Source stamps, directory membership, candidate revisions, root/catalog identity
  and trash settings bound external races; this is not an OS filesystem transaction.
- Vault changes invalidate old menus/scripts and old-page mutation requests. Document
  sessions remain until the user reloads; tag operations reject stale overlays.
- Original plugins/configurations and flags remain. Plus 1.3.x takeover prevents only
  menuManager/unusedImages/multiTag/tagWrangler construction; other modules load.
- Fresh core/search declarations, complete web/server/desktop TypeScript, isolated
  web production, standalone server and desktop main/preload bundles, relative-require
  guard and generated-code syntax checks passed. Regression sources were typechecked,
  not executed. Vite reports large chunks; runtime/performance remain unmeasured.
  No app/server/browser, real Vault, server/public, release or packaging was changed.

## Support references and limits

- [Browser userscripts](browser-userscripts.md): GM/metadata matrix, page-world trust,
  main-document-only execution and unverified site timing.
- [Configured menus](configured-menus.md): JSONC, passive examples, reload and context/
  command limits. Native MarkdownView menus do not emit plugin editor-menu events
  without a compatible Obsidian editor bridge.
- [Attachment cleanup](attachment-cleanup.md): sources/types, unknown-data coverage,
  dynamic-reference protection, token expiration and partial failures.
- [Native tags](native-tags.md): ranges, unsafe-YAML skips, merge confirmation,
  saved catalog counts, unsaved overlays and manual acceptance.
