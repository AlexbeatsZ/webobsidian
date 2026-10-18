# Desktop window chrome

## Required layout

Windows/Linux use one 32px top row. The left edge starts with File, Edit, View,
Window and Help. Do not draw the application icon or application name in this
row. Keep native minimize/maximize/close controls at the right and allow dragging
through the empty area. Support light and dark themes.

The window title and application icon remain available to the taskbar and app
switcher. macOS retains its native title and system menu bars. Ordinary browser
tabs retain the existing web layout.

## Implementation

- `desktop/src/main.ts` hides the system title and native menu rows on
  Windows/Linux, enables a native title bar overlay, and retains the application
  menu for its actions and accelerators.
- `desktop/src/titlebar.ts`, bundled into preload, inserts the header before the
  SPA root and subtracts its height from that root. Only the menu buttons are
  excluded from the draggable area. The overlay's safe-area variables reserve
  space for native window buttons.
- Top-level buttons open their original native submenus through IPC. Restore
  editor focus before opening a submenu so Edit actions retain their target.
- F10 / Alt enter the menu bar; left/right select a menu; down/Enter/Space open
  it; Escape restores content focus. Alt + a menu initial opens it directly.
- IPC is restricted to the main window's top-level localhost frame. The renderer
  can request only existing top-level submenus and fixed light/dark colors.
- Watch the SPA root and theme wrapper, not the editor subtree, to update title
  bar and native caption-button colors when the theme changes.

## Delivery status

Implemented on 2026-10-18. The user subsequently requested a build: core, server,
web and desktop type checks and the Windows x64 installer/portable build passed.
Runtime and UI acceptance remain skipped at the user's request. The existing
running app was not replaced or restarted.
