import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface McpLauncherState {
  projectPath: string;
  configured: boolean;
  ok?: boolean;
  output?: string;
}

export class McpLauncher {
  private busy = false;

  async inspect(projectPath: string): Promise<McpLauncherState> {
    let configured = false;
    try {
      const manifest = JSON.parse(await fs.readFile(path.join(projectPath, 'package.json'), 'utf8'));
      const entry = await fs.stat(path.join(projectPath, 'scripts', 'manual-start-mcp.ps1'));
      configured = manifest.name === 'obsidian-context-mcp' && entry.isFile();
    } catch {}
    return { projectPath, configured };
  }

  async connect(projectPath: string, endpointFile: string): Promise<McpLauncherState> {
    if (process.platform !== 'win32') throw new Error('手动启动目前仅支持 Windows 桌面端');
    if (this.busy) throw new Error('MCP 操作仍在进行，请稍候');
    this.busy = true;
    try {
      const state = await this.inspect(projectPath);
      if (!state.configured) throw new Error('请选择包含手动启动脚本的 obsidian-context-mcp 项目');
      const command = '$ProgressPreference = "SilentlyContinue"; $OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new(); try { & $env:WEBOBSIDIAN_MCP_MANUAL -Action $env:WEBOBSIDIAN_MCP_ACTION -EndpointFile $env:WEBOBSIDIAN_MCP_ENDPOINT *>&1 | ForEach-Object { $_.ToString() }; exit $LASTEXITCODE } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }';
      const executable = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      return await new Promise(resolve => {
        execFile(executable, ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], {
          cwd: projectPath, windowsHide: true, timeout: 60_000, maxBuffer: 32 * 1024, encoding: 'utf8',
          env: { ...process.env, WEBOBSIDIAN_MCP_MANUAL: path.join(projectPath, 'scripts', 'manual-start-mcp.ps1'),
            WEBOBSIDIAN_MCP_ACTION: 'Connect', WEBOBSIDIAN_MCP_ENDPOINT: endpointFile },
        }, (error, stdout, stderr) => {
          const output = [stdout.trim(), stderr.trim(), error?.killed ? '连接操作超时；未自动重试，请稍后手动连接' : error && !stdout && !stderr ? error.message : ''].filter(Boolean).join('\n');
          resolve({ ...state, ok: !error, output });
        });
      });
    } finally { this.busy = false; }
  }
}
