# Focused page command and navigation routing

Date: 2026-11-01. Release: 0.1.43.

## Reproduced failure

The original two regression cases fail on the previous source: after clicking
the split page, Ctrl+O replaces the main page, and Bookmark/Move on a blank
reading page target main.md rather than side.md. Evidence:
`.local/focus-routing-20261101/red/results`.

## Ownership and change

`activeEditor` now owns one transient navigation identity alongside the actual
editor. Existing page hosts activate main/split/sidebar IDs for pointer and
keyboard focus; identity survives command/file palettes, title input, blank
reading surfaces and editor loading/replacement. No second global keyboard
listener, document session, parser, save pipeline or persisted focus state.

The store resolves currentViewId/currentPath, defaults ordinary file/link/page
opening to that target, retains explicit main targets for main tabs and URL
restore, and keeps back/forward stacks per view using existing NavigationLocation
capture/remapping/restoration. Saving a reading page targets that page. Native
commands, command contexts, plugin Workspace/activeLeaf, current-folder note
creation, fixed side panels, minimap, status and mode controls reuse this target.
Modes, selection and scrolling remain per-view; document/history/save stay in
DocumentSession. Empty or loading split/sidebar pages retain their leaf identity.

Removed main-only routing and path/DOM guesses at these call sites. No new
typing-time analysis/index rebuild or workspace serialization. No measured
performance claim.

## Verification

- Baseline: 2/2 new regressions fail with explicit wrong-page evidence.
- Real-App isolated backend regression: 10 focus cases cover picker routing,
  reading-page Bookmark/Move and Save, independent history, next-tab versus
  explicit main-tab clicks, heading picker/outline, footer mode controls,
  sidebar replacement/close, split Homepage/new-note/current folder, same-file
  view identity and recovery after close.
- Related browser run: 69/69 pass in 2.9 minutes, including 25 prior split
  cases, 17 location/navigation, 9 minimap, 4 sidebar and 4 palette cases.
  After the final empty-leaf correction, all 10 focused cases pass again in
  39.5 seconds, including closing the split Homepage without closing main.
- Web/Server/Desktop typechecks pass in the isolated snapshot. Original
  related unit run 24/24 passes. Final isolated full run: **499/499 in 88
  files**, 48.79 seconds with one worker, including two empty-leaf regressions.
- Initial expanded run was 67/69: sidebar expected six fixed buttons despite
  the already-existing Properties panel, and palette fixture lacked Vault
  placement settings/awaited creation. Updated those fixtures to the current
  product contract; no product assertion was weakened. The broad rerun passes.
- Initial full unit run under concurrent work: 496/497, one unchanged Git
  backup case exceeded its existing 5-second limit. Its standalone 5/5 rerun
  passes without timeout/test changes. The final full run also passes.

## Isolation and delivery

- Source/tag: `c1f4d488ebfb9ab446012556d4486a3a0a4d9f7b`, `v0.1.43`, normally
  pushed to AlexbeatsZ/webobsidian. Exact committed archive compiled core,
  renderer, server and desktop; standalone server/MCP guards passed and
  Windows NSIS built successfully (129,834,829 bytes; File/Product 0.1.43).
- Actual packaged production resources with a disposable Vault passed focused
  picker replacement, independent Back, mode targeting, real keyboard input,
  disk Save and Close while preserving main (1,782ms; zero renderer errors).
  Evidence: `.local/focus-routing-20261101/production/result.json` and screenshot.
- Existing packaged-startup regression also passed on the same actual resources
  (6,556ms measured by the verifier), covering native features/templates/MCP/
  Pele/attachments/table surfaces.
- Downloaded the actual CI Windows installer (129,834,833 bytes), verified
  embedded EXE File 0.1.43/Product 0.1.43.0, and extracted its actual resources
  without installation. The same focused production verification passes in
  1,780ms with zero renderer errors. Evidence:
  `.local/focus-routing-20261101/release-production/result.json`.
- Cross-platform release workflow `41291336070`: Windows, macOS and Linux all
  pass at the exact source above. `v0.1.43` is published, non-draft and
  non-prerelease; all 17 asset names/sizes/uploaded states read back and the tag
  points to c1f4d48. The current local delivery is the downloaded CI installer,
  its blockmap and BUILD-INFO.json under `desktop/release/0.1.43`.
- General CI `41291318142` has a failed Typecheck & build job while its broader
  browser job was still running at publication; Docker passed. This release is
  not claimed as all-CI/all-browser clean. Focused/current local acceptance is
  the isolated evidence above.

Only owned files are copied over an exact committed archive under
Temp/.agents/webobsidian-focus-043-*; unrelated native-only removal work is
excluded. Source/root server/public, daily Vaults, installed040 assets/profile,
credentials, proxy and running user processes are preserved. Temporary test
servers and browsers use disposable Vaults. No installation/current-user-window or
other-device acceptance is implied.

Cleanup was attempted once for this task's three exact Temp build/validation/
extraction directories after checking the intended boundary in the command.
Automatic approval rejected the command before execution with `blocked by
policy`; no specific reason was supplied. No retry or alternate removal was
performed. These temporary copies remain; current delivery/evidence and all
unrelated or historical builds are preserved.
