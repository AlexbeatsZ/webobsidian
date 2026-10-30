# Platform icon delivery 2026-10-30

## Scope and source

- User-supplied `Notes_icons_macOS_Windows.zip` is the source of the native icons.
  Its ICNS, ICO and 1024px PNG files are copied byte-for-byte into
  `desktop/buildResources/`; the earlier composite screenshot is not an input.
- macOS uses the rounded dark-purple tile; Windows uses the transparent crystal.
  Android explicitly shares the macOS design. Linux keeps its existing icon.
- Desktop and Android release version: 0.1.36 / Android versionCode 36.

## Implementation and checks

- electron-builder selects the supplied platform ICNS/ICO. Development windows
  use the Windows ICO and macOS development Dock uses the macOS PNG. Packaged
  apps continue using the native application-bundle/executable icon.
- Supplied macOS ICNS includes 16–1024px representations; Windows ICO includes
  16, 24, 32, 48, 64, 128 and 256px. Both contain transparency.
- Android's existing notes vector is removed. Both manifest icon fields use one
  launcher resource: five density-specific legacy PNGs and a 108dp adaptive icon
  with a matching dark-purple background. Its generated foreground is derived
  from the macOS master, with the crystal within the 66dp safe circle.
- Desktop typecheck passes. Source diff whitespace check passes. Original PNGs
  and a light-background macOS/Windows/Android round-mask preview were inspected.
  At 4x density, opaque crystal pixels above blue=100 have radial extent129.99px
  inside the132px safe radius.
- No rendering/parser/document/session logic or runtime dependency changes.

## Build and publication

Native desktop CI and isolated Android packaging are pending at this source
checkpoint. Final artifact checks and publication results will be recorded here.
No installation, app restart, live Vault/profile changes or physical
Dock/taskbar/Android launcher acceptance is claimed.
