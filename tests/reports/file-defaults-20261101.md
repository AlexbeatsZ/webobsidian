# File locations and inline note-title rename — 2026-11-01

## Delivered behavior

- Settings > Files and Links > Default Location saves note/Canvas and attachment
  destinations. Notes choose root/current/specified folder; attachments additionally
  choose a subfolder of the current file's folder. Defaults stay root/attachments.
- Native new-file commands, folder actions, file-search creation and unresolved
  bare links share the placement rule. Explicit paths and folder choices win.
  Homepage/no-file context falls back to root. Existing files are not moved.
- Upload requests carry the receiving source path. Existing folder case and
  explicit upload directories are retained. Multiple pasted images append to the
  latest DocumentSession rather than replacing previous images or edits.
- Page filename title is directly editable in live, source and reading modes.
  Enter/blur uses the existing renamePath operation; Escape cancels. Folder and
  extension stay unchanged. Draft, history, open paths and source body use the
  existing document lifecycle. Invalid/colliding names retain the original file.
  Embedded/locked documents receive no rename capability.

## Architecture and ownership

The shared pure filePlacement schema/rule owns placement validation and selection;
the existing settings store persists it. New-file browser callers share one
settings read entry. Existing Vault writers, upload routing, title DOM plugin,
RenderContext callback, renamePath and DocumentRegistry remain the owners. No new
parser, index, writer, settings store, renderer or document registry was added.
No settings fetch occurs during typing or selection updates.

Concurrent MCP create/rename source was committed independently before this
feature. Shared-file ownership was agreed by range; its implementation and the
pre-existing OAuth hotfix/report and .workbuddy changes were preserved.

## Verification

- Full units: **487/487**, 87 files, `vitest run --maxWorkers=2`, 23.25s.
  The initial default-worker run alongside browser work timed out in two unchanged
  5s tests; both pass in the bounded full run without assertion/timeout changes.
- Placement boundary cases rerun after adding Homepage handling: **3/3**.
- Server/Web/Desktop TypeScript: pass on the final source.
- Frozen real-backend Edge browser run: **12/12**, 53.8s. Four feature cases and
  eight existing Appearance regressions. Includes settings persistence/reload,
  nested missing folders, unique filenames, Canvas, explicit folders, current
  folders, unresolved links, Homepage, all attachment modes, existing folder case,
  explicit upload override, traversal rejection, all three title modes, matching
  H1, draft/Undo, cancellation, empty/invalid/colliding titles, reload and two-image
  paste without changing the other split.
- Settings/title screenshots were visually inspected. Evidence:
  `.local/file-defaults-20261101/browser/results/`.

The browser fixture uses a disposable real backend/Vault and the actual App,
Editor and Settings. Teardown drains in-flight requests before ending its own
backend. It does not return fake successful backend responses.

## Packaging boundary

Version **0.1.42** is pinned to **9988134679ecd6fb08dc4c9e6783ee8b9849b5e2**.
Placement/title source is the independent preceding commit `0942a5d`; the pinned
commit integrates the split-editing owner's completed source so an upgrade retains
the installed split hotfix. Later active-pane routing work belongs to 0.1.43 and
was excluded from this archive/build.

- Final combined browser acceptance: **37/37**, 2.7min (feature4 + Appearance8 +
  split25). No source changes were made during this frozen run.
- Exact archived source units: **497/497**, 88 files, 45.97s with one worker;
  Desktop types pass, Web/Server types pass as part of production compilation.
  The two-worker archive run passed496 and timed out in the unchanged Git backup
  case at5s; the serialized full run passes without changing tests or timeouts.
- Isolated search/core/Web/Server/Desktop compilation, standalone index/MCP bundle
  guards, official bundled Tunnel and Windows NSIS packaging pass. Vite retains
  existing chunk-size/dynamic-import warnings. Initial snapshot dependency mapping
  omitted the existing nested ts-dedent package; correcting the mapping needed no
  product-source change. Build never overwrote root server/public.
- Actual `win-unpacked/resources` server+SPA general packaged-startup acceptance
  passes: edit/save/native snippet/template, equation and body references, JS
  widget, Pele, MCP queue/pin, search, menus, attachment protection, right tabs and
  generated table themes. Zero renderer errors.
- Actual packaged feature smoke, **1,668ms**, **zero route overrides**: real
  Settings save, Ctrl+N creates in Inbox, inline title renames on disk without
  changing source text, attachment writes to the note-relative assets folder,
  reload retains title, pre-existing note bytes preserved. errors=[]. Evidence:
  `.local/file-defaults-20261101/production/result.json`, settings/renamed images.
- Local NSIS: `desktop/release/0.1.42/WebObsidian-0.1.42-win-x64-setup.exe`,
  **129,834,618 bytes**; actual packaged EXE FileVersion0.1.42/ProductVersion0.1.42.0.
  BUILD-INFO.json records the exact source and packaged acceptance.
- Tag v0.1.42 pushed. Native release workflow **41290227526**: Windows/macOS/Linux
  all pass. [Published 0.1.42](https://github.com/AlexbeatsZ/webobsidian/releases/tag/v0.1.42)
  was marked latest at publication. Local verified Windows installer/blockmap/latest/BUILD-INFO were
  uploaded together and the installer size was read back exactly.
- Concurrent platform uploads initially split Mac artifacts across another draft
  with the same tag. All seven Mac assets were downloaded/uploaded with name/size
  checks into published release430459281; the task-created duplicate draft430459504
  was removed only after destination readback. Final inventory: **17assets**, one
  published0.1.42 release. Tag readback is exactly9988134679ecd6fb08dc4c9e6783ee8b9849b5e2.
- General CI **41289858487** has a failed Typecheck & build job: the unchanged
  runtimeDependencies static import scan exceeds its5s test timeout (496/497 pass).
  The exact local serialized full run passes497/497. Docker passes. Broad browser
  CI completes349pass/8fail: quoted-formula click/input, embed-edit strict locator,
  three footnote navigation cases, scroll500 visual equality, sidebar ribbon6vs7,
  and the palette creation fixture's immediate assertion after the now-async
  directory lookup. Subsequent focused-page routing owner independently corrected
  the palette fixture settings and async poll in0.1.43/c1f4d48; this does not rewrite
  the0.1.42 CI result. Other broad failures were not attributed or repaired in this
  task. Native release success does not mean all general CI is green.

No daily app restart, installation, live Vault write, physical IME/mobile/macOS UI
acceptance or remote Tunnel authentication claim is made by this delivery.

## Cleanup limit

The final local0.1.42 installer/blockmap/update metadata/BUILD-INFO remain in
`desktop/release/0.1.42`; evidence remains in `.local/file-defaults-20261101`.
One attempt to remove this task's isolated source/archive/unpacked build/Mac asset
transfer directory was rejected **before execution** by automatic approval with
only `blocked by policy`. No retry, alternate deletion or move was attempted.
Retained path: `C:/Users/Meta/AppData/Local/Temp/.agents/webobsidian-files-042-21d08fc3`.
Other owners' work and previously blocked cleanup were not touched.
