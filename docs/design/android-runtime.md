# Android local runtime

## Contract and owners

Android runs independently and offline. `RuntimeHost` loads an Android/Bionic
`libnode.so` in one background thread in the app process. The same
`scripts/bundle-server.mjs` used by Electron packages the complete existing
Express service and SPA. The WebView connects only to that device's random
`127.0.0.1` port. No computer service, hosted page, login or second mobile
backend is involved.

The shell owns Android lifecycle, WebView, permissions and file-upload picker.
All editing/history/save remains in DocumentSession; Markdown syntax in
markdown-core; saved metadata/search in VaultCatalog and existing indexes;
configuration, watchers, HTTP/WebSocket and maintenance in the existing server.
`App` uses the existing registry to request dirty-session saves on visibility
loss/pagehide/native background events. The normal 900ms autosave remains in
Editor. There is no guarantee against an OS kill before an in-flight save;
conflicts retain their existing behavior instead of overwriting disk.

Node starts only after explicit Vault selection, once per app process, and survives Activity recreation. Closing a
window/backgrounding does not attempt to restart Node in-process. Android may
kill a background app; the next process starts the same persistent Vault and
indexes. No background foreground-service or permanent wake lock is added.
Versioned immutable bundled assets are copied under `files/runtime-<code>` only
until their completion marker exists. User Vault/configuration are never part
of the asset extraction. Native stdout/stderr go to `files/logs/server.log`.

## Storage

First launch remains on a native selection screen. No runtime or Vault is
created until the user chooses: open an existing local folder through Android's
all-files permission screen and system directory picker, or explicitly create
an app-private Vault with an entered name and confirmation. Cancel leaves the
selection flow without creating a Vault. Only local external-storage provider
URIs resolve to real filesystem paths; cloud/unsupported providers receive an
explicit error, never an imported/mirrored substitute. The chosen path is shown
for confirmation. Old 0.1.17 `files/Vault` contents are retained and offered as
an explicit existing-Vault choice; upgrading does not silently adopt them.

New private Vaults use `getFilesDir()/vaults/<chosen-name>`. Uninstall removes
private files; the create dialog explains this. Server state remains in
`getFilesDir()/server-data`. The native preference stores only whether initial
selection succeeded, not a second selected path. `RuntimeHost` reads the existing
settings.json Vault on subsequent starts, checks accessibility, and never calls
mkdir on an implicit/default Vault. It passes a first choice once through
WEBOBSIDIAN_INITIAL_VAULT. Before indexing or any client/watcher exists, server
index calls the same `assertVaultPathAllowed`, `updateSettings`,
`ensureVaultBrowsable` and workspace selection used by the existing settings
route. Existing notes/configuration are retained, with ordinary settings backups.
Later Vault changes remain the normal settings/maintenance flow. Allowed roots
include external storage/selected volume only if the OS all-files grant is
present. Android still restricts other applications' private directories.

This deliberately uses the original filesystem authority: no SAF-to-private
mirror, periodic import, hidden sync or duplicate note store. Cloud-only
providers/SAF URIs are outside this build's contract. The all-files permission
is a sideloaded personal-app choice; this is not a Google Play publication.
Git requires an executable and is not bundled on Android; local notes, search,
MathJax, templates and native configuration do not require it. Electron guest
WebViewer/userscript capabilities are not provided by Android's WebView.

## Touch

The existing useIsMobile query covers a coarse primary pointer as well as narrow
screens, so Android tablets use the same single `mobileDrawer` state. App owns
one gesture lifecycle: inward swipe from 28 CSSpx left/right edge opens that
side; outward swipe in the drawer/backdrop closes it. Minimum displacement is
45 CSSpx, horizontal/vertical ratio 1.3, maximum duration 900ms. Vertical motion,
multitouch, cancellation, selections, interior editable fields, Canvas and
horizontal scrolling containers retain native behavior. Only an eligible
horizontal gesture prevents native scrolling. SidebarDock and all panel/guest
lifetime rules remain unchanged. Android Back first dismisses an open drawer,
then backgrounds the task. Top-row buttons/backdrop remain alternative controls.
The native host reserves only the middle200dp segment at each28dp edge through
Android's system gesture-exclusion API, so sidebar swipes there are not stolen
by system Back; Back remains available on the rest of each edge. See Android's
[gesture-navigation guidance](https://developer.android.com/develop/ui/views/touch-and-input/gestures/gesturenav).
The outer native FrameLayout owns this exclusion rather than WebView, which
can refresh its own gesture-exclusion list. Actual 0.1.17 device evidence showed
12px edge swipes received no touch events while60px (24CSSpx) did receive them
and opened the existing drawer; this is not a JavaScript recognizer failure.

## Native window lifetime and Insets (0.1.18)

MainActivity is singleTask: repeated launcher/explicit starts reuse the existing
Activity/WebView. Actual 0.1.17 task dumps showed two Activity records after
repeated start, explaining the old paused WebView and unanswered maintenance
check; rotation alone was not established as the cause. Tablet size/layout
configuration changes retain the original view. Real destruction detaches,
navigates blank and destroys the view; no stale-client exemption is added to
server maintenance. Node remains process-owned.

One outer FrameLayout applies system-bars (including caption), display-cutout
and IME Insets to child layout bounds. It forwards zero remaining overlap to
WebView. Removed WebView padding and decorFitsSystemWindows=true compensation:
padding WebView did not shrink its actual CSS viewport and status-bar text
overlapped tab/settings controls on Android15. No CSS offset pipeline is added.
This follows [Android's parent-layout Insets guidance](https://developer.android.com/develop/ui/views/layout/webapps/understand-window-insets).

## Build and delivery

Prerequisites: existing Java17, Android SDK35, NDK28.2.13676358, CMake3.22.1.
No automatic SDK download/global installs. `android/local.properties` selects
the existing SDK; Gradle wrapper is pinned at8.13, AGP8.13.0. Android11+ arm64.

Run in an isolated source checkout, never against a live server's public tree:

```sh
npm ci
npm run build
node android/scripts/runtime.mjs
node android/scripts/prepare.mjs
node android/scripts/signing.mjs
cd android
./gradlew --no-daemon :app:assembleRelease :app:assembleDebug
```

Release key/properties remain in ignored `android/.signing` and must be retained
for future updates. `io.github.alexbeatsz.webobsidian` is the signed personal
release; `.debug` is a distinct application identity and data directory for
acceptance. Neither build command installs, starts, uninstalls or clears an app.
Android version.properties owns Android0.1.18/versionCode18 independently;
the accepted Mac packages remain0.1.17 and are not rebuilt for this correction.

Runtime is pinned to [fogtape/nodejs-mobile v24.22.1-0](https://github.com/fogtape/nodejs-mobile/releases/tag/v24.22.1-0),
full ICU, based on Node24 LTS, distributed as a **prerelease** by that project.
This supplies a current Android library and 16KB page support; the original
nodejs-mobile published Node18 archive is not used. Startup environment follows
the distribution's [embedding contract](https://github.com/fogtape/nodejs-mobile/blob/recipe/docs/EMBEDDING.md):
explicit HOME/TMPDIR, writable cwd, private data and bounded V8 heap. Native
library/license files are downloaded only into ignored project dependencies.

## Independent acceptance entry points

Parent owns device tests. Install only the `.debug` variant when no such test
app exists; do not replace an existing daily application. Its Vault is
`/data/user/0/io.github.alexbeatsz.webobsidian.debug/files/Vault` (available with
`adb shell run-as io.github.alexbeatsz.webobsidian.debug`); log is `files/logs/server.log`.
Launch `.MainActivity`; WebView debugging is enabled only in that variant.
Stage disposable ordinary Markdown files in the debug Vault, edit/save/read
back, background/reopen and restart process; verify device offline with no PC
port forwarding. Test both edge opens and in-panel closes on phone/tablet,
vertical scroll, text selection, pinch/cancel, horizontal table scrolling,
keyboard Insets and Back. Native permission/shared-folder tests use a disposable
shared-storage directory only. Build/static evidence is not device acceptance.
