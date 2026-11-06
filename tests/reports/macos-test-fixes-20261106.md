# macOS shortcut and known-failure regression — 2026-11-06

Scope: the failures listed by session `mac:claude:cb89b265`, including the four
previously recorded `elements.spec.ts` failures. The requested modifier mapping
is Ctrl → Control and Alt → Option. Fixtures use temporary Vault/data directories
under the platform `.agents` temp directory; the installed app and real Vault
are outside this acceptance.

## Reproduced baseline

The seven affected browser/integration files ran 94 cases: 79 passed, 15 failed.
`operations.test.ts` separately reproduced its case-only rename failure (15/16).
These are sixteen observed failures, not assumptions based on an old log.

| Area | Failures | Resolution |
| --- | ---: | --- |
| Elements | 4 | Literal Control undo/select-all plus async formula geometry correction |
| Embed editing | 2 | Literal Control+End/history; scope the range-marker assertion to the owning root content |
| Math transition | 1 | Control+Z uses the shared document history |
| Navigation | 4 | Wait for async footnote locations; handle Mac Control+primary contextmenu as the existing sidebar-opening intent |
| Rendering | 2 | Control clipboard uses the existing source policy; font completion remeasures list prefixes |
| Theme/search | 1 | Literal Control+F opens the editor search panel |
| Saved embed integration | 1 | Control+End inserts into the actual target, preserving host bytes |
| Review/native rename | 1 | Filesystem alias detection and exact directory-entry recovery on case-insensitive APFS |

## Implementation boundaries

- Application defaults, editor commands and native file-menu accelerators use
  literal Control. Stored explicit Mod/Meta bindings retain their meanings.
- Option-generated symbols/dead keys match the base letter/digit/punctuation
  of an Alt shortcut. AltGraph/composition handling stays in CommandManager.
- Clipboard operations reuse ContentClipboardPolicy, including metadata,
  readonly and stale-state guards. History remains owned by DocumentSession.
- The natural content height makes async SVG size changes observable even in
  short notes. Math readiness follows CM measurement; no pointer-coordinate
  correction is added. Blank scroll-area input has its own browser regression.
- File renaming retains physical writer locks, fresh revisions, collision
  checks and raw bytes. New tests cover lost acknowledgement/restart and an
  unchanged interrupted case-only rename. Mac Vault keys are not lowercased.

## Verification

- Full unit suite: **546/546**, 97 files (`vitest run --testTimeout=30000`).
  The longer timeout accommodates real Git subprocess tests.
- Previously unstable layout cases: **6/6** across three repetitions.
- Dedicated Control/Option, clipboard, readonly and blank-area input checks:
  **8/8** across two repetitions.
- Server, renderer and desktop TypeScript checks passed. Root production build
  and desktop standalone bundling passed.
- Mac arm64 and x64 0.1.62 packages built; both app signatures passed
  `codesign --verify --deep --strict`, and executable architectures matched.
- Packaged arm64 production server/renderer regression passed with system
  Chrome and disposable data: boot/Vault identity, real editor input/disk
  save, native snippet, template, executable widget, block effects, equation
  references, reading/source modes, search, menu, attachments and theme surfaces.

The expanded browser/integration run passed **160/160** in 3.2 minutes. It
included all seven baseline files plus keyboard mapping, content clipboard,
split editing, content references, prefix rendering and source syntax. The
split cases cover focused Save, pane-local modes/history, shared drafts,
failures during close/replace, empty/readonly panes and layout/theme parity.
The completed run used a fresh Vite process with no concurrent source edits;
an earlier run contaminated by HMR module identity changes was discarded.

This is automated source and packaged-entry evidence on macOS. It does not
claim physical-keyboard acceptance, an installed-app upgrade, Windows/Linux
execution or x64 runtime acceptance.
