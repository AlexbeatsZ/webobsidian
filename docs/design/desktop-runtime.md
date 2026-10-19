# Desktop server packaging and startup

## Standalone server contract

The desktop build copies the built SPA and bundles the compiled Express server
into `resources/server/dist/index.mjs`. It does not ship the server's
`node_modules` tree. The desktop shell starts this entry with its own Electron
executable and `ELECTRON_RUN_AS_NODE=1`, bound to a random loopback port. User
vault/config/data paths are passed separately and are not build inputs.

The server bundle aliases only `jsonc-parser` to its supplied ESM entry. Its
default UMD entry passes `require` into a factory; esbuild leaves calls such as
`require2('./impl/format')` in the bundle. Those files are absent from the
standalone distribution. This caused the 2026-10-18 Windows 0.1.1 package to
exit at import time, confirmed by the user's 2026-10-19 server log. Increasing
the startup deadline does not address that import failure.

`desktop/scripts/check-server-bundle.mjs` rejects surviving literal relative
`require` calls in esbuild's generated output before packaging. It can also
inspect the actual `win-unpacked/resources/server/dist/index.mjs` without
importing or starting it. This catches the reported UMD packaging regression;
it is not a general proof that every dynamic import or startup path will work.

## Startup failure reporting

Open the server log before spawning the child. Capture both stdout and stderr
until the child's streams close, and finish writing them before reporting its
exit. Record spawn errors and early exits while polling `/healthz` so a crashed
child fails promptly with its exit status and log path. The 30-second deadline
still applies to a live process that never becomes healthy.

On Windows the log is under
`%APPDATA%/@webobsidian/desktop/logs/server.log`. Startup diagnostics must never
print the persisted secret or reset desktop config/vault data to fix packaging.

## Verification boundary

Use type checks, production builds and the static bundle check when the user
requests static verification only. Do not launch Electron, the server, the
installer, a browser, or a real vault for acceptance under that instruction.
Report successful packaging separately from user-confirmed startup/workflows.
