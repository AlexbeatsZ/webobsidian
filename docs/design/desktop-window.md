# Compact workspace and desktop chrome

## Required layout

Windows/Linux use one 32px top row containing the left-sidebar toggle, compact
file/Homepage tabs, a new-Homepage button, a draggable empty area and the right-sidebar toggle.
Native minimize/maximize/close controls occupy the right end of that same row.
Do not display File / Edit / View / Window / Help, an app icon/name, an extra note
header or a formatting toolbar. Tabs use 12px UI text, compact gaps, a maximum
width of 180px and horizontal scrolling; sidebar/Homepage controls remain pinned.
The row height matches the existing native overlay height; native button widths
remain controlled by the OS.

Both vertical ribbons share their sidebar's visibility. The two SidebarDock hosts
float over the workspace below the titlebar without reserving document columns;
the top-row toggles remain available to restore them. Left contains Files/Search;
right contains the four existing fixed panels. Both have a + entry and independent note,
browser or plugin-view tabs. Mobile keeps device-local drawer visibility.
See workspace-sidebars.md for ownership, persistence and lifecycle contracts.

The three + buttons open the same Homepage actions without creating files. The
top tabs use rounded upper corners and curved lower joins for the active tab,
quiet inactive hover, and visible close controls on the active/hovered tab. The
32px native row, caption insets and draggable empty region stay in place.
Settings and the Vault switch menu live in the left footer; the utility group
formerly at the bottom of the right ribbon is removed.

The Markdown view selector is a single icon in the bottom-right status bar. It
opens an upward menu containing 阅读视图, 源码模式 and 实时预览 with a check beside
the current mode. It supports keyboard navigation, Escape, focus/outside-click
dismissal and closes when the active file changes. It is hidden for non-Markdown
tabs. On mobile only this status control is shown. No Source/Live/Reading strip
remains above the editor.

File actions formerly available from the note header's More button are available
from the corresponding tab's context menu (including bookmark, split, properties,
PDF, history and sharing). The document title remains part of the document view.
Native vault/window actions and accelerators remain available through F10 on
Windows/Linux. macOS retains the system title/menu bars; browsers share the new
workspace layout without native caption insets or draggable regions.

## Implementation

- web/src/components/WorkspaceTabs.tsx owns the shared tab row and tab context
  menus. It is a direct child of .app, spanning all grid columns in row 1.
  The editor occupies row 2; SidebarDock overlays are positioned below row 1.
- Workspace.tsx owns only editor/split content, paste/drop and the status bar.
  The redundant note header and FormatToolbar component/styles are removed.
- ViewModeMenu.tsx reads/writes the existing store mode; no new view or document
  state is introduced. StatusBar.tsx hosts it alongside existing plugin items.
- App.tsx selects device-local or shared open state. SidebarDock owns both side
  layouts and resizing; right guest hosts survive hiding the dock or tab.
- desktop/src/main.ts keeps titleBarStyle: hidden and the native 32px overlay.
  The native application menu has no visible row. A fixed F10 popup IPC is
  restricted to the main local top-level frame. Fullscreen events remove caption
  reservations while the native overlay is absent.
- desktop/src/titlebar.ts, bundled into preload, marks the native titlebar
  layout and synchronizes native caption colors. It observes only the root and
  theme wrapper, never editor descendants. A blank draggable fallback is present
  during loading/login and hidden when the React workspace mounts; it never
  subtracts another row from the root height.
- The main BrowserWindow opens before cold server indexing with a script-free
  local loading document and a 32px drag strip. The same window navigates to the
  workspace after server/login/userscript readiness; repeated launches focus it.
- obsidian.css uses native titlebar-area-x/width safe-area variables (138px
  caption-width fallback), keeps controls/tabs no-drag, and reserves at least
  40px of empty drag space. Narrow Electron windows retain the native 32px row
  instead of the mobile browser's 48px row.

## Verification and delivery

The 2026-10-22 opinion changes above are source-only and unverified. The user
explicitly declined acceptance, tests, typechecks and builds for this batch. No
application, server or browser was launched, and no package was created. The
following evidence belongs to the earlier compact-chrome implementation.

2026-10-22: isolated current-core declarations, web/desktop type checks, production
SPA and main/preload bundles, generated JS syntax and all 186 manifest resources
passed. The ordinary web typecheck initially found stale project-local core
declarations; compiling current core into the isolated build resolves them.

No browser, Electron, server, installer or interactive tests were launched, in
accordance with the standing static-only boundary. Actual titlebar geometry,
native dragging/Snap behavior, mobile touch and view-menu interaction remain
user acceptance. The follow-up Windows x64 portable build 0.1.5 includes this UI;
packaged version, UI markers, 186 resources and standalone server checks pass.
The former 0.1.4 artifacts were removed before packaging. Existing app, vault and
server/public were preserved; the new portable was not launched or installed.
