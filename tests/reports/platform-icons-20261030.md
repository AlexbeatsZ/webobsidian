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

- Exact source/tag: `27b5700bcc026137ac8d582423142d44150abb2c` / `v0.1.36`.
  Source and tag normally pushed to the user's fork.
- Native desktop CI `41051348610` passed Windows (2m35s), macOS (4m02s) and
  Linux (3m46s). Both macOS architectures ran the existing custom ad-hoc signer
  with its deep/strict codesign verification.
- Isolated clean npm installation, shared core/Web/Server production compilation,
  Android standalone preparation, release/debug Gradle builds and lintVitalRelease
  passed (92 Gradle tasks, 32s). Existing project signing identities were retained.
  Both APKs verify using v2 signatures and pass `zipalign -c -P 16 4`.
- Actual CI Windows installer was extracted without running it. Main executable
  and installer each contain all seven original ICO image payloads byte-for-byte.
  PE/asar version is0.1.36; packaged standalone-server guard passes.
- Actual macOS arm64 ZIP contains an ICNS byte-identical to the supplied source.
  Intel packages were built/signed by native CI; their ICNS was not downloaded
  and independently compared.
- Both APKs contain all five legacy densities, the432px adaptive foreground and
  adaptive-icon XML. All visible RGBA pixels and alpha match generated masters.
  AAPT rewrote RGB values on two fully transparent pixels in the192px PNG; this
  has no visible effect and is explicitly excluded from the visual equality.
- Released as latest non-draft/non-prerelease at2026-10-30T12:04:12Z. Remote
  readback confirms19 uploaded assets and the exact tag target. Names/byte sizes
  of all four locally delivered packages match the remote assets.

| Package | Bytes |
| --- | ---: |
| Windows x64 NSIS |105608029|
| macOS arm64 ZIP |132589797|
| Android arm64 release APK |135169279|
| Android arm64 debug APK |138366437|

Local packages are in `desktop/release/0.1.36` and `android/release/0.1.36`,
with build-info JSONs. Evidence/logs/readbacks are under
`Temp/.agents/webobsidian-platform-icons-036-20261030`. Preview and resource
inspection scripts are under `.local/desktop-icons-20261030`.

The initial npm install attempted to download Electron and timed out; the
Android-only build then used process-local ELECTRON_SKIP_BINARY_DOWNLOAD=1.
No global environment or dependency versions changed. CI installed its own
native Electron dependencies normally. The first archive extraction assumed
an inner NSIS payload, but7-Zip had already unpacked the application directly;
final icon checks used that actual extracted application.

## Cleanup and acceptance boundaries

Automatic approval rejected deletion of this task's own snapshot, dependencies,
copied signing material, source archive and unpacked Windows payload before
execution, reporting only "blocked by policy". No retry, rewritten deletion or
workaround was attempted. Those Temp duplicates remain; the original signing
material remains untouched. Older rejected cleanup and historical artifacts
were not retried.

Root `server/public/index.html` length/UTC timestamp is unchanged. Installed
apps, user processes, profiles, Vaults and unrelated `.workbuddy` are untouched.
No installation, app restart, physical Dock/taskbar/Android launcher behavior,
Developer ID/notarization or broad application regression acceptance is claimed.
