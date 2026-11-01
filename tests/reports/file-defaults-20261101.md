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

Version 0.1.42 production build, packaged startup smoke and publication are pending.
No daily app restart, installation, live Vault write, physical IME/mobile/macOS UI
acceptance or remote Tunnel authentication claim is made by the source checks.
