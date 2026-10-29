# 2026-10-28 Native MCP manual launcher

## Request and ownership

- Add manual recovery inside the program rather than another external shortcut.
- Right MCP panel owns the controls; Electron main owns local process execution.
- Reuse companion `scripts/manual-start-mcp.ps1` without copying Tunnel state,
  credential handling, retry/identity or runtime start/stop implementations.
- The desktop bridge permits only Start/Restart/Status and validates the existing
  top-level same-origin sender. No HTTP/MCP process-launch route is introduced.
- Host-local project selection uses desktop-config.json, not Vault config. Default
  project discovery matches the existing user's companion checkout; another host
  may explicitly select its configured companion. Missing entries fail visibly.
- Commands run only on explicit clicks; no polling, edit-path work or automatic
  reconnect. Native command execution is single-flight, hidden and bounded.

## Verification

- Focused launcher/desktop sender units: 14/14 passed.
- MCP browser cases: 5/5 passed (19s), including 3 existing context regressions
  and 2 native-bridge UI fixtures: no auto-start, Start/Restart/Status mapping,
  busy controls, nonzero output, retry, selection cancellation and missing project.
- Full units: 426/426 in 76 files passed (5.70s); Web/Server/Desktop types passed.
- Adjacent sidebar regressions: 4/4 passed (8s).
- Isolated build/package and real packaged Electron fixture acceptance pending.
- First native fixture passed command mapping but screenshot inspection exposed
  PowerShell CLIXML progress/information in output and inherited clickable-row
  hover styling. Before publication, stream normalization now suppresses progress,
  converts merged records to plain text and preserves script exit codes; the
  launcher uses its own neutral layout and existing themed buttons. Native fixture
  now asserts exact Write-Host/Write-Output text and absence of CLIXML.

## Boundaries

- Native fixture test uses only a disposable project, Vault and desktop profile;
  it must not disconnect or start the user's real Tunnel.
- Existing companion/Node installation and Tunnel configuration are prerequisites;
  controls do not install dependencies, create connections or rewrite credentials.
- Script completion is not proof that a remote ChatGPT request succeeded. The
  original intermittent disconnect cause remains unconfirmed.
- No installed application replacement, live Vault migration or other-platform
  launcher support is claimed.
