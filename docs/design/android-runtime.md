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
The embedded Node heap is bounded at1024MiB. A real STEM cold index exceeds the
old384MiB limit. Android rebuilds its derived full-text index on process start
instead of loading or serializing MiniSearch's disposable desktop JSON cache:
exporting that entire index duplicates it and can exceed even1536MiB. Saved
notes, catalog semantics, search behavior and desktop caching remain unchanged.
Cold Android startup therefore waits for the ordinary complete index build.
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

Launcher icons use the supplied macOS rounded purple tile. The five legacy
mipmap densities and the 108dp adaptive foreground are generated from the single
`desktop/buildResources/icon-macos.png` master by
`android/scripts/generate-icons.py`. The adaptive background fills the mask with
the matching dark purple; the crystal stays within the central 66dp safe circle.
Both manifest icon fields resolve the same adaptive resource, so the launcher
owns the final round/squircle shape. The old unrelated notes vector is removed.

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
./gradlew --no-daemon :app:assembleRelease :app:assembleTabletRelease
```

Release key/properties remain in ignored `android/.signing` and must be retained
for future updates. `io.github.alexbeatsz.webobsidian` is the signed personal
release; `.debug` is a distinct application identity and data directory for
acceptance. Neither build command installs, starts, uninstalls or clears an app.
Android version.properties owns Android0.1.66/versionCode66 independently. This
Android delivery bundles the current shared renderer and server from desktop
0.1.65, including continuous documents and the Android heap/cache correction above. The existing tablet uses
the `.debug` identity and its original Windows
debug signing key; preserve that identity and signer for in-place updates.
The Redmi K70 uses the release application identity and its existing release key.
Deploy each device with its current identity; never uninstall or clear app data
to work around a signing mismatch. Keep only the latest local APK for each
required identity after successful upgrades.

Runtime is pinned to [fogtape/nodejs-mobile v24.22.1-0](https://github.com/fogtape/nodejs-mobile/releases/tag/v24.22.1-0),
full ICU, based on Node24 LTS, distributed as a **prerelease** by that project.
This supplies a current Android library and 16KB page support; the original
nodejs-mobile published Node18 archive is not used. Startup environment follows
the distribution's [embedding contract](https://github.com/fogtape/nodejs-mobile/blob/recipe/docs/EMBEDDING.md):
explicit HOME/TMPDIR, writable cwd, private data and bounded V8 heap. Native
library/license files are downloaded only into ignored project dependencies.

## Daily builds and historical tablet identity (2026-11-08)

Daily device deployments must be non-debuggable release builds. Never deploy
assembleDebug merely to preserve the installed tablet identity. Android package
ID and signing certificate are update/data identity; debuggable, BuildConfig.DEBUG
and JNI/WebView debugging are separate build/runtime flags. Keeping a historical
.debug package or a certificate originally called a debug key does not require
a debuggable app.

The ordinary release variant updates Redmi K70. tabletRelease initializes from
release, retains applicationIdSuffix '.debug' and the tablet's existing signer,
and explicitly sets debuggable=false and jniDebuggable=false. Both generate
BuildConfig.DEBUG=false; MainActivity passes that flag to
WebView.setWebContentsDebuggingEnabled, keeping WebView inspection off.
The version name has no -debug suffix. This does not enable shrinking/obfuscation
or claim a measured performance improvement; the shared production SPA is
unchanged. Debug variants are for explicitly requested isolated diagnostics only.

Tablet credentials are read from ignored android/.signing/tablet.properties
with storeFile/storePassword/keyAlias/keyPassword (same format as release).
Restore its existing certificate from OMEN C:/Users/Meta/.android/debug.keystore;
restore the phone's release credentials from the existing Windows project's
android/.signing/release.p12 and release.properties. Never commit these files,
generate a replacement key, change package IDs, uninstall, clear data, or copy a
Vault to migrate a daily device just to disable debugging. An explicit
requireTabletKey task rejects missing credentials before tabletRelease builds.

Before the existing debuggable tablet becomes non-debuggable, normally background
the app so existing saves finish and retain a private-data backup in the task's
restricted temporary directory. Afterwards run-as is expected to reject access;
do not re-enable debugging to read private logs. Check APK manifest and generated
BuildConfig, installed package flags/certificate/UID/firstInstallTime, and launch
without attaching a debugger. Device ADB connectivity is a separate transport;
this requirement does not change system USB/wireless debugging settings.

## Independent acceptance entry points

Parent owns device tests. A debuggable variant is only for explicitly requested
isolated diagnostics when no such test app exists; do not replace a daily
installation with it. Normal device delivery uses the release variants above.
For a separately authorized isolated debug test installation, the disposable Vault is
`/data/user/0/io.github.alexbeatsz.webobsidian.debug/files/Vault` (available with
`adb shell run-as io.github.alexbeatsz.webobsidian.debug`); log is `files/logs/server.log`.
Launch `.MainActivity`; WebView debugging is enabled only in that variant.
Stage disposable ordinary Markdown files in the debug Vault, edit/save/read
back, background/reopen and restart process; verify device offline with no PC
port forwarding. Test both edge opens and in-panel closes on phone/tablet,
vertical scroll, text selection, pinch/cancel, horizontal table scrolling,
keyboard Insets and Back. Native permission/shared-folder tests use a disposable
shared-storage directory only. Build/static evidence is not device acceptance.
