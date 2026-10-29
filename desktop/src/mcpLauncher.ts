import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export type McpLauncherAction = 'Start' | 'Restart' | 'Status';

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

  async run(projectPath: string, endpointFile: string, action: unknown): Promise<McpLauncherState> {
    if (process.platform !== 'win32') throw new Error('手动启动目前仅支持 Windows 桌面端');
    if (!['Start', 'Restart', 'Status'].includes(action as string)) throw new Error('无效的 MCP 操作');
    if (this.busy) throw new Error('MCP 操作仍在进行，请稍候');
    this.busy = true;
    try {
      const state = await this.inspect(projectPath);
      if (!state.configured) throw new Error('请选择包含手动启动脚本的 obsidian-context-mcp 项目');
      const command = '$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new(); & $env:WEBOBSIDIAN_MCP_MANUAL -Action $env:WEBOBSIDIAN_MCP_ACTION -EndpointFile $env:WEBOBSIDIAN_MCP_ENDPOINT; exit $LASTEXITCODE';
      const executable = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      return await new Promise(resolve => {
        execFile(executable, ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], {
          cwd: projectPath, windowsHide: true, timeout: 60_000, maxBuffer: 32 * 1024, encoding: 'utf8',
          env: { ...process.env, WEBOBSIDIAN_MCP_MANUAL: path.join(projectPath, 'scripts', 'manual-start-mcp.ps1'),
            WEBOBSIDIAN_MCP_ACTION: action as string, WEBOBSIDIAN_MCP_ENDPOINT: endpointFile },
        }, (error, stdout, stderr) => {
          const output = [stdout.trim(), stderr.trim(), error?.killed ? '操作超时，请检查状态后再重试' : error && !stdout && !stderr ? error.message : ''].filter(Boolean).join('\n');
          resolve({ ...state, ok: !error, output });
        });
      });
    } finally { this.busy = false; }
  }
}
