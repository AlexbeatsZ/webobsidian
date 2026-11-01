# Built-in desktop MCP — 2026-10-31

## Delivered behavior

Desktop 0.1.39 ships the native MCP adapter and pinned official Secure MCP
Tunnel 0.0.19. The MCP panel no longer looks for a companion source directory,
PowerShell launcher, Obsidian plugin or external Node installation.

The panel keeps manual Connect, adds local-client configuration copy and
host-local Tunnel settings. OS-backed safeStorage encrypts runtime keys;
missing encryption fails closed. Startup/panel mount do not connect remotely.
One application-owned Tunnel child forwards to the current instance's `/mcp`;
normal quit stops that child after the existing save acknowledgement.

The shared operation contract and native HTTP dispatcher still own the six
tools. Both bundled stdio and stateless Streamable HTTP use one MCP factory.
DocumentSession, context persistence, source coordinates, human review,
catalog/search and the actual file writer remain unchanged. The external
project reader/picker/IPC and `scripts/start-mcp.ps1` were removed together.

## Validation

- Unit suite: **469/469**, **85 files**.
- Server, Web and Desktop typechecks: passed.
- Focused MCP browser suite: **6/6**, 24.2 seconds. Includes exact selections,
  path-only context, one-shot delivery, persistence, manual retry and the
  cross-platform settings/copy interface without a project picker.
- Isolated production compilation and Windows NSIS packaging: passed.
- Standalone dependency checks: backend and bundled MCP both passed.
- Actual packaged Windows Electron executable with a separate profile/Vault:
  HTTP and stdio initialize, enumerate the same six tools, read the test note,
  and submit two proposals that remain `awaiting_user_review`. No note bytes
  change. Stdio uses the packaged WebObsidian executable with PATH pointed at
  an empty directory, and the obsolete companion path intentionally does
  not exist.
- Actual packaged IPC/settings: missing Tunnel credentials show a real
  configuration error, OS-encrypted dummy key roundtrip passes, no secret
  returns to the renderer, configuration copying matches the bundled entry,
  and the original desktop-config fields are retained.
- Packaged official Tunnel binary reports **0.0.19**. Its supported
  control-plane/MCP/health flags match the launcher's fixed argument array.
- Zero renderer page errors in native acceptance.
- Native evidence: `.local/builtin-mcp-20261031/native/result.json` and
  `native-mcp-builtin.png`.

An initial full unit run found nine obsolete desktop test fixtures without
the new app-path discovery method. Those fixtures were updated; the complete
469-test rerun passed. An initial server test typecheck needed an explicit
JSON result type; the final Server/Web/Desktop typechecks pass.

## Delivery boundary

The Windows package is verified independently of the installed user instance.
The user's running application, real Vault/profile, cloud registrations and
remote Tunnel credentials are untouched. No real remote key is used by the
test; remote Tunnel readiness and ChatGPT end-to-end receipt are not claimed.
Mac/Linux share the package hook and platform-specific pinned binary mapping;
native physical acceptance on those hosts remains separate.
