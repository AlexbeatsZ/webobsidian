# Minimap bounded responsibility cleanup — 2026-10-26

Status: implementation and focused validation complete; owned ranges frozen for parent integration. No commit, push, package, installation or Vault changes.

## Ownership and callers

- `RightSidebar` remains the sole product caller of `MarkdownMinimap`, keyed by document path. No caller or shared contract outside the assigned minimap scope changed.
- `MarkdownMinimap` retains the existing DocumentSession subscription, main-view selection, search subscriptions, animation-frame coalescing, viewport projection, pointer/keyboard navigation and theme/host-size invalidation.
- `paintMarkdownMinimap` in `markdownMinimapCanvas.ts` owns the existing bounded canvas rendering and diagnostics. It consumes the existing model, CodeMirror document, measured width and shared search ranges; it owns no subscriptions or writable document state.
- `observeMinimapLayout` in `markdownMinimapLayout.ts` owns the current main editor's geometry/media observations and scroll listener. Its concrete caller is `MarkdownMinimap`; no generic observer framework was introduced.

## Changes and removed complexity

- Removed `watchMedia` from drawing, including its per-paint `disconnect` and full media re-observation. Theme/search redraws retain the existing observation set.
- Observe existing media once at binding. A subtree child-list observer inspects newly added DOM subtrees and observes only new matching targets; targets no longer contained by the editor are individually unobserved. This detects media mounted by CodeMirror virtualization without rendering offscreen content.
- Scroll, DOM mounting and ResizeObserver notifications share the component's existing animation frame. One measured column/source-width comparison determines whether layout requires painting; ordinary scrolling and height-only changes update the viewport without repainting the canvas.
- Removed `lastColumn`, the media-width WeakMap and separate component-owned column/editor/media observer setup. Geometry now uses the border box consistently; rendered scroll width is adjusted into that box before comparison. There is no content-box initialization/callback mismatch.
- View replacement and component unmount dispose layout observations and the scroll listener. Disposed observer callbacks cannot schedule more work.
- Preserved the existing 512 × 2048 canvas limit, at most 682 sampled rows, shared analysis/parser, search semantics, main-view navigation, source, cursor and Undo ownership. No explanatory UI copy or guessed offscreen maximum was added.

## Focused validation

- `npm run test:unit -- web/src/lib/markdownMinimap.test.ts`: **6/6 passed**, 982 ms total / 107 ms tests.
- `npm --workspace web run typecheck`: **passed** (`tsc -b --noEmit`).
- `npm run test:render -- tests/browser/markdown-minimap.spec.ts`: **9/9 passed, 29.2 s**, Edge, port **5196**, one worker, no retries or skipped tests. Existing core output was reused with `RENDER_TEST_SKIP_CORE_BUILD=1`; no production build ran.
- Existing browser runtime-error assertions passed. Focused owned tracked diff whitespace check passed; only Git line-ending conversion notices were printed.

The three new browser cases cover:

1. Repeated theme-triggered paints do not add media observations or disconnect the observer; removed table targets are unobserved and closing the panel disconnects/clears the observer.
2. A wide table initially outside the virtualized DOM mounts after navigation, expands measured source width, then is unobserved and restores normal width when scrolling away. Ordinary scroll before the table mounts does not repaint.
3. A padded/bordered column measures one consistent box; height-only resize does not invalidate width; mounted media width changes and removal update measurements; disposed layout subscriptions do not fire after later media, geometry or scroll changes.

The six retained cases cover source width/font/overflow, ordinary scroll/click/drag with main-versus-split ownership and unchanged source/cursor/Undo, CodeMirror regex and workspace search highlights with stale-range rejection, 30,000-line bounded sampling/theme/narrow viewport/file switching, live/reading reuse without another editor/script execution, and real SearchPanel publication/clearing.

Initial run: **8/9 passed, 36.9 s**. The cleanup assertion incorrectly required zero remaining media while CodeMirror retained a connected `img.cm-widgetBuffer`. A focused diagnostic rerun confirmed that target. The assertion now requires the removed table to be unobserved, every retained target to remain connected, and all targets to clear on disposal. No production change was made to satisfy this fixture correction. Initial failure traces are retained separately from the final run.

Evidence directories:

- Final: `C:/Users/Meta/AppData/Local/Temp/.agents/minimap-structure-20261026-final`
- Initial: `C:/Users/Meta/AppData/Local/Temp/.agents/minimap-structure-20261026`
- Diagnostic: `C:/Users/Meta/AppData/Local/Temp/.agents/minimap-structure-20261026-rerun`

## Changed paths and acceptance boundary

- `web/src/components/MarkdownMinimap.tsx`
- `web/src/lib/markdownMinimapCanvas.ts` (new)
- `web/src/lib/markdownMinimapLayout.ts` (new)
- `tests/browser/markdown-minimap.spec.ts`
- `tests/reports/minimap-structure-20261026.md` (new)

Parent PDF/store/commands/docs/Git changes and unrelated `.workbuddy` were preserved. Port 5194 was not used. These are focused source/browser/type results, not production, installed Electron, Android, live-Vault or long-run acceptance. The tests establish subscription/paint behavior; no latency or memory speedup is claimed. Parent owns integrated acceptance and Git closeout; no further minimap changes are pending from this owner.
