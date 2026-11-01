# fix(workspace): 统一分屏文档宿主与视图身份

## Final delivery: shared hosts and installed-resource parity

The initial fix below restored editing but left two different pane hosts and a layout-taking split header. It was incomplete and is superseded by this final implementation and two-resource hotfix.

- Both Markdown panes now use exactly `WorkspacePane → EditorPane → Editor → MarkdownView`, with explicit `path` and `navigationId: main | split`. Removed the split-only path/header row and direct-Editor branch. Both panes use the same `.pane` layout and overlay close control; inset separation does not subtract one pane's content width.
- Main retains persisted workspace mode; split/sidebar retain instance-local mode. Each MarkdownView owns selection, folding and scroll. Same-file views share DocumentSession content, history and saves. Existing split saveLeaving/generation/failure recovery remains authoritative.
- `obsidian/workspace.ts` resolves Markdown views and activeLeaf by registered context navigationId, replacing readOnly/path/DOM guesses. The existing activeEditor activation handler now handles both focusin and pointerdown, so clicking a blank reading pane targets commands correctly; nearest-editor filtering and symmetric cleanup remain. No forced focus, extra selection transaction or second keyboard/coordinate pipeline.
- Concurrent placement/upload/title changes remain outside this fix. Canvas retains its existing central capability; no dual-Canvas support is claimed. No per-keystroke analysis/index/workspace serialization was added, and no speedup is claimed.

### Final validation

All runtime tests used disposable Vaults/profiles, not the daily Vault.

- Web typecheck: passed.
- 27/27 focused units: workspaceIdentity, workspacePersistence, sidebarTabs and writing/editorRouting (`--maxWorkers=2`).
- 25/25 `tests/browser/split-editing.spec.ts` browsers, 1.6 minutes: editing/save/failure recovery; 12 same-note light/dark × live/source/reading × rich/blank comparisons; actual same-file view identity and close commands; blank-reading-pane pointer activation and command-palette mode/save/close in both directions. Maximum layout difference **0 CSS px**, actual CDP glyph fonts match, original 0.1px tolerance unchanged.
- Candidate with actual installed standalone server: passed in 13,274ms; original installed control reproduced a 41px split content-origin offset.
- Actual modified installation, zero route overrides (`routed: []`): passed in 10,787ms, 12 comparisons, maximum difference 0. Both production runs verified real input and disk saves in both panes, same-file Undo/Redo and correct split close-save; errors=[]; installed JS `node --check` passed.
- Evidence: `.local/split-editing-20261101/parity-source-complete/results/`, `parity-production/result.json`, `parity-installed/result.json` and `parity-hotfix-manifest.json`. Temporary browsers/servers/Vaults were cleaned up.

### Applied Windows 0.1.40 local hotfix

Actual installed assets under `C:/Users/Meta/AppData/Local/Programs/WebObsidian/resources/server/public/assets/`:

- `index-C7kMEYtw.js`: 2,378,956 bytes.
- `index-BvQm-pfG.css`: 128,278 bytes.
- Exact recovery backup: `C:/Users/Meta/AppData/Local/Temp/.agents/webobsidian-split-parity-xzEBrm/`.

`prepare-parity.mjs` compiles the real shared source hosts/identity/activation/mode and owned CSS, maps installed imports and removes superseded implementations. `apply-parity.mjs` checks unchanged source/installation and successful production evidence, writes a pending manifest, replaces CSS then JS and verifies readback with guarded rollback. Manifest confirms applied=true and installedReadbackMatches=true. Do not reapply or overwrite the applied manifest. The earlier one-JS hotfix below is historical.

No app/window launch, refresh or restart; no real note/profile/settings/server bundle/MCP/Tunnel/proxy/root server/public changes. **Save with Ctrl+S, then Ctrl+Shift+R to load the new resources.** Version remains 0.1.40 plus local hotfix; no new installer, release or commit by this chat. Next source-based deliverable must include these source hunks, or an older 0.1.41/0.1.42 snapshot can overwrite the hotfix.

### Explicit limits

No full-suite, physical IME, other-platform or user's current-window/live-Vault acceptance. Canvas embedded `Editor path reading embedded` currently lacks an explicit navigationId and can inherit the split default; this is a static potential identity edge, not a reproduced failure or accepted Canvas behavior. Track separately rather than restoring path/readOnly/DOM inference. Source-mode title behavior remains installed 0.1.40's policy, not concurrent 0.1.42 title functionality.

## Historical initial editing-only fix (superseded)

### Root cause and scope

`Workspace.tsx` rendered the split with an unconditional `reading` prop. That disabled native input, manual save and mode switching in every secondary pane. Removing that prop alone was insufficient: explicit-path split editors still subscribed to the main workspace mode, and the previously read-only split had no document-exit save barrier.

- `web/src/components/Workspace.tsx`: split uses the ordinary Editor, not a forced reading projection.
- `web/src/components/Editor.tsx`: explicit-path editors reuse the existing instance-local mode state, as sidebar editors already do. The main view retains its existing persisted workspace mode.
- `web/src/lib/store.ts`: split replacement and close await the authoritative `DocumentRegistry.saveLeaving`, keep the view/draft on failure or new input during save, and retain existing generation guards. Remote layout application also saves the split. Failed split navigation stops before fragment positioning.
- `docs/design/workspace-sidebars.md`: document split ownership and lifecycle.
- `tests/browser/split-editing.spec.ts`: eight focused real-App, real disposable-backend browser regressions.

DocumentSession continues to own content/history/analysis/autosave. MarkdownView continues to own input, selection, folding and scroll. Focused global/manual Save reuses activeEditor/manualSave. No new writer, parser, input listener, index or per-keystroke workspace serialization. No performance improvement is claimed.

Concurrent file-default placement/upload/inline-title edits in the same three files are not part of this fix and were preserved. No staging, commit, version change or release publication in this task.

## Source validation

All fixtures used disposable Vaults, never the user's daily Vault.

- `npm --workspace web run typecheck`: passed.
- `npx --no-install vitest run web/src/lib/workspacePersistence.test.ts web/src/lib/sidebarTabs.test.ts web/src/lib/writing/editorRouting.test.ts --maxWorkers=2`: 17/17, 3 files, 1.28s.
- `RENDER_TEST_SKIP_CORE_BUILD=1 RENDER_TEST_PORT=5193 RENDER_TEST_BROWSER='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' RENDER_TEST_OUTPUT_DIR='.local/split-editing-20261101/browser' npx --no-install playwright test tests/browser/split-editing.spec.ts --project=render --workers=1`: 8/8, 31.0s.
- Browser coverage: actual keyboard input in both panes; per-document disk bytes and manual-formatting target; independent live/source/reading; same-file synchronization with local selections/shared undo/redo; close and replacement save barriers; HTTP 507 retains editable draft and allows retry; new input during close-save retains newest draft.
- `git diff --check`: passed. Full unit/browser suites and other platform/native IME tests were not run.

## Urgent installed Windows hotfix

To make the fix usable without waiting for another release or interrupting revision work, applied only the six corresponding changes to the installed 0.1.40 frontend entry:

`C:/Users/Meta/AppData/Local/Programs/WebObsidian/resources/server/public/assets/index-C7kMEYtw.js`

Original 2,374,782 bytes → patched 2,375,041 bytes. Exact original backup:

`C:/Users/Meta/AppData/Local/Temp/.agents/webobsidian-split-hotfix-kws6gkq5/index-C7kMEYtw.original.js`

The guarded preparation requires each old compiled section exactly once. Application requires unchanged installed bytes/entry, the exact production-tested candidate and a successful production report, then atomically replaces that one asset and reads it back. No whole frontend rebuild, root `server/public` overwrite, server bundle modification, installation, app restart, profile/Vault/configuration/credential/proxy/Tunnel change. Version remains 0.1.40 with this local hotfix; it is not a new release.

### Actual installed-resource evidence

Verifier: `.local/split-editing-20261101/verify-hotfix.mjs`.

1. Before apply, actual installed standalone server with disposable DATA_DIR/Vault, original installed SPA: reproduced split `data-mode=reading`, `contenteditable=false`.
2. Candidate route overrides only that one JS entry; all APIs/CSS/chunks are actual installed originals: passed in 5,559ms.
3. After apply, `node .local/split-editing-20261101/verify-hotfix.mjs --installed`: passed in 3,806ms with **zero route overrides**, using the actual modified installed asset and actual installed standalone server against another disposable Vault.
4. Both production runs exercise real picker Alt+Enter, keyboard input and Mod+S on both documents with disk readback, per-pane modes via real command palette, replacement via real tab split menu, same-file cross-pane undo/redo, and close-save behavior. No uncaught renderer or console errors. Parent inspected the two-edited-documents screenshot.
5. Candidate and actual installed JS both pass `node --check`. Disposable browsers/servers and fixture Vaults were closed/removed; the original recovery backup remains.

Evidence: `.local/split-editing-20261101/production/result.json`, `installed-result.json`, screenshots and `hotfix-manifest.json`. The initial verifier attempt stopped because the candidate was not ready; it launched no processes and is superseded by the two successful runs. A source-fixture teardown aborted backlinks request was recorded in the candidate run, not a renderer failure.

The user's current renderer was **not** refreshed. Save current work with Ctrl+S, then Ctrl+Shift+R (or reopen the application) to load patched resources. Static fetch to the profile's persisted endpoint was unavailable, and no WebObsidian process was found at the bounded read-only process check; do not claim the user's current window/live Vault was accepted. No automatic launch or restart was attempted.

## Handoff

The source fix is still a working-tree change. Concurrent release owners must preserve its owned hunks and include them in the next source-based deliverable; an older 0.1.41/0.1.42 snapshot may otherwise replace this local hotfix when installed. No other-platform delivery, new installer or live-Vault acceptance is claimed.
