# 2026-10-28 Native MCP manual launcher

## Request and ownership

- Add manual recovery inside the program rather than another external shortcut.
- Right MCP panel owns the controls; Electron main owns local process execution.
- Reuse companion `scripts/manual-start-mcp.ps1` without copying Tunnel state,
  credential handling, retry/identity or runtime start/stop implementations.
- Final user direction: only one **连接** button. It checks status once on click,
  leaves a healthy runtime alone, starts a stopped one, or restarts an unhealthy
  running one using the companion's existing lifecycle implementation. There is
  no status button, timer, background check or retry. The project picker is an icon.
- The desktop bridge exposes only parameter-free Connect and validates the existing
  top-level same-origin sender. No HTTP/MCP process-launch route is introduced.
- Host-local project selection uses desktop-config.json, not Vault config. Default
  project discovery matches the existing user's companion checkout; another host
  may explicitly select its configured companion. Missing entries fail visibly.
- Commands run only on explicit clicks; no polling, edit-path work or automatic
  reconnect. Native command execution is single-flight, hidden and bounded.

## Verification

- Focused launcher/desktop sender units: 14/14 passed.
- MCP browser cases: 5/5 passed, including 3 existing context regressions
  and 2 native-bridge UI fixtures: no auto-start, single Connect mapping,
  busy controls, nonzero output, retry, selection cancellation and missing project.
- Full units: 426/426 in 76 files passed (6.31s); Web/Server/Desktop types passed.
- Final MCP + adjacent sidebar browser regressions: 9/9 passed (26.7s).
- Companion 0.2.2: 65/65 tests, build, packaging and extracted stdio smoke passed.
  Five state-decision tests cover healthy/no-op, stopped/start, unhealthy or stale
  running/restart, stop failure and malformed/timed-out status; each checks once.
- Isolated build/package and real packaged Electron fixture acceptance pending.
- First native fixture passed command mapping but screenshot inspection exposed
  PowerShell CLIXML progress/information in output and inherited clickable-row
  hover styling. Before publication, stream normalization now suppresses progress,
  converts merged records to plain text and preserves script exit codes; the
  launcher uses its own neutral layout and existing themed buttons. Native fixture
  now asserts exact Write-Host/Write-Output text and absence of CLIXML.

## Release history

- 0.1.30 (42ac0aa) was published before the final single-button clarification:
  NSIS 105609994 bytes, real native fixture and production smoke (6109ms) passed.
  It exposed three manual actions; no automatic reconnect/polling was introduced.
- Final single-button delivery is 0.1.31 with companion 0.2.2, packaging pending.
- Superseded local builds and temporary source copies were moved, not permanently
  deleted, into Temp/.agents/.trash/webobsidian-builds-20261028-9687ece5 under the
  user's updated cleanup instructions. Existing installed 0.1.28 was not changed.

## Boundaries

- Native fixture test uses only a disposable project, Vault and desktop profile;
  it must not disconnect or start the user's real Tunnel.
- Existing companion/Node installation and Tunnel configuration are prerequisites;
  controls do not install dependencies, create connections or rewrite credentials.
- Script completion is not proof that a remote ChatGPT request succeeded. The
  original intermittent disconnect cause remains unconfirmed.
- No installed application replacement, live Vault migration or other-platform
  launcher support is claimed.
