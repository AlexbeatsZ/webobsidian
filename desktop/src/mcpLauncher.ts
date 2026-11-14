import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { writeJson } from './files';

export interface McpConnectionInput { tunnelId: string; apiKey?: string }
export interface McpLauncherState {
  available: boolean;
  tunnelId: string;
  hasKey: boolean;
  connected: boolean;
  clientConfig: string;
  ok?: boolean;
  output?: string;
}
interface Options {
  runtimeDir: string;
  binary: string;
  mcpEntry: string;
  executable: string;
  endpointFile: string;
  serverUrl: string;
  // Structural boundary keeps web-only builds independent of Electron types.
  secrets: {
    isEncryptionAvailable(): boolean;
    encryptString(value: string): Buffer;
    decryptString(value: Buffer): string;
    getSelectedStorageBackend?(): string;
  };
}
interface Connection { tunnelId: string; encryptedKey: string }

/** One application-owned Tunnel process; all MCP tools remain in the server. */
export class McpLauncher {
  private busy = false;
  private child?: ChildProcess;
  private output = '';
  constructor(private readonly options: Options) {}

  private get configFile() { return path.join(this.options.runtimeDir, 'connection.json'); }
  private get healthFile() { return path.join(this.options.runtimeDir, 'health.url'); }

  private async readConnection(): Promise<Connection> {
    try {
      const value = JSON.parse(await fs.readFile(this.configFile, 'utf8'));
      if (typeof value.tunnelId !== 'string' || typeof value.encryptedKey !== 'string') throw new Error('MCP 连接设置无效');
      return value;
    } catch (error: any) {
      if (error.code === 'ENOENT') return { tunnelId: '', encryptedKey: '' };
      throw error;
    }
  }

  async inspect(): Promise<McpLauncherState> {
    const connection = await this.readConnection();
    const available = await Promise.all([this.options.mcpEntry, this.options.binary].map(file => fs.stat(file).then(entry => entry.isFile(), () => false)));
    return {
      available: available.every(Boolean), tunnelId: connection.tunnelId, hasKey: !!connection.encryptedKey,
      connected: !!this.child && this.child.exitCode === null && !this.child.killed,
      clientConfig: JSON.stringify({ mcpServers: { webobsidian: {
        command: this.options.executable, args: [this.options.mcpEntry],
        env: { ELECTRON_RUN_AS_NODE: '1', WEBOBSIDIAN_ENDPOINT_FILE: this.options.endpointFile },
      } } }, null, 2),
    };
  }

  async configure(input: McpConnectionInput): Promise<McpLauncherState> {
    if (this.busy) throw new Error('MCP 操作仍在进行，请稍候');
    this.busy = true;
    try {
      if (!input || typeof input.tunnelId !== 'string' || !/^tunnel_[a-zA-Z0-9_-]{8,120}$/.test(input.tunnelId.trim()))
        throw new Error('Tunnel ID 无效');
      if (input.apiKey !== undefined && (typeof input.apiKey !== 'string' || input.apiKey.length > 4096 || /[\r\n\0]/.test(input.apiKey)))
        throw new Error('运行密钥无效');
      const previous = await this.readConnection();
      const apiKey = input.apiKey?.trim();
      let encryptedKey = previous.encryptedKey;
      if (apiKey) {
        if (!this.options.secrets.isEncryptionAvailable() || this.options.secrets.getSelectedStorageBackend?.() === 'basic_text')
          throw new Error('系统密钥存储不可用，无法保存运行密钥');
        encryptedKey = this.options.secrets.encryptString(apiKey).toString('base64');
      }
      if (!encryptedKey) throw new Error('请填写 Tunnel 运行密钥');
      const connection = { tunnelId: input.tunnelId.trim(), encryptedKey };
      await writeJson(this.configFile, connection);
      await this.stop();
      return await this.inspect();
    } finally { this.busy = false; }
  }

  private async healthy(): Promise<boolean> {
    if (!this.child || this.child.exitCode !== null || this.child.killed) return false;
    try {
      const url = new URL((await fs.readFile(this.healthFile, 'utf8')).trim());
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password) return false;
      const result = await fetch(new URL('/readyz', url), { signal: AbortSignal.timeout(1500) });
      return result.ok;
    } catch { return false; }
  }

  async connect(): Promise<McpLauncherState> {
    if (this.busy) throw new Error('MCP 操作仍在进行，请稍候');
    this.busy = true;
    try {
      const state = await this.inspect();
      if (!state.available) throw new Error('安装包缺少内置 MCP 组件，请重新安装 WebObsidian');
      if (!state.tunnelId || !state.hasKey) throw new Error('请先在连接设置中填写 Tunnel ID 和运行密钥');
      const local = await fetch(`${this.options.serverUrl}/healthz`, { signal: AbortSignal.timeout(3000) });
      if (!local.ok) throw new Error('本机 WebObsidian 服务尚未就绪');
      if (await this.healthy()) return { ...state, connected: true, ok: true, output: '已连接' };
      await this.stop();
      const connection = await this.readConnection();
      const apiKey = this.options.secrets.decryptString(Buffer.from(connection.encryptedKey, 'base64'));
      await fs.mkdir(this.options.runtimeDir, { recursive: true });
      await fs.rm(this.healthFile, { force: true });
      const env = { ...process.env };
      for (const key of Object.keys(env)) if (/^(CONTROL_PLANE_|OPENAI_|TUNNEL_|MCP_|ELECTRON_RUN_AS_NODE)/i.test(key)) delete env[key];
      env.CONTROL_PLANE_API_KEY = apiKey;
      this.output = '';
      const child = spawn(this.options.binary, [
        'run', '--control-plane.tunnel-id', connection.tunnelId,
        '--mcp.server-url', `${this.options.serverUrl}/mcp`,
        '--health.listen-addr', '127.0.0.1:0', '--health.url-file', this.healthFile,
      ], { cwd: this.options.runtimeDir, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      this.child = child;
      let failure: Error | undefined;
      const capture = (chunk: Buffer) => {
        this.output = (this.output + chunk.toString('utf8')).split(apiKey).join('[redacted]').slice(-16384);
      };
      child.stdout?.on('data', capture); child.stderr?.on('data', capture);
      child.on('error', error => { failure = error; });
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        if (failure) throw new Error(`MCP 连接失败：${failure.message}`);
        if (child.exitCode !== null) throw new Error(`MCP 连接失败：${this.output.trim() || `exit ${child.exitCode}`}`);
        if (await this.healthy()) return { ...state, connected: true, ok: true, output: '已连接' };
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      throw new Error(`MCP 连接超时：${this.output.trim() || '请检查网络和运行密钥'}`);
    } catch (error) {
      await this.stop();
      return { ...await this.inspect(), ok: false, connected: false, output: (error as Error).message };
    } finally { this.busy = false; }
  }

  private stopping?: Promise<void>;
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode != null || !child.pid) {
      this.child = undefined;
      return Promise.resolve();
    }
    this.stopping = new Promise<void>((resolve, reject) => {
      const force = setTimeout(() => child.kill('SIGKILL'), 5000);
      const timeout = setTimeout(() => finish(new Error('MCP 连接无法停止')), 10_000);
      const finish = (error?: Error) => {
        clearTimeout(force);
        clearTimeout(timeout);
        child.removeListener('close', closed);
        if (error) reject(error);
        else { if (this.child === child) this.child = undefined; resolve(); }
      };
      const closed = () => finish();
      child.once('close', closed);
      child.kill();
    }).finally(() => { this.stopping = undefined; });
    return this.stopping;
  }
}
