[CmdletBinding()]
param(
    [ValidateSet('Start', 'Restart', 'Stop', 'Status')]
    [string]$Action = 'Start',
    [string]$TunnelProject = (Join-Path (Split-Path -Parent $PSScriptRoot | Split-Path -Parent) 'obsidian-context-mcp'),
    [string]$EndpointFile,
    [string]$NodeExe,
    [switch]$LaunchApp,
    [switch]$Pause
)
$ErrorActionPreference = 'Stop'
$manual = Join-Path $TunnelProject 'scripts\manual-start-mcp.ps1'
if (-not (Test-Path -LiteralPath $manual -PathType Leaf)) { throw "Manual Tunnel entry not found: $manual" }
$options = @{ Action = $Action; LaunchApp = $LaunchApp; Pause = $Pause }
if ($EndpointFile) { $options.EndpointFile = $EndpointFile }
if ($NodeExe) { $options.NodeExe = $NodeExe }
& $manual @options
exit $LASTEXITCODE
