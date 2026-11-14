import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createLogStream } from './files';

export class ServerProcess {
  private child?: ChildProcess;
  private stopping = false;
  private stopped?: Promise<void>;
  private logClosed?: Promise<void>;
  constructor(private readonly options: {
    executable: string;
    entry: string;
    dataDir: string;
    logFile: string;
    env: NodeJS.ProcessEnv;
    onExit(error: Error): void;
  }) {}

  async start(): Promise<number> {
    if (this.stopping) throw new Error('本地服务启动已取消');
    const { executable, entry, dataDir, logFile, env } = this.options;
    await fs.mkdir(dataDir, { recursive: true });
    const endpointFile = path.join(dataDir, 'operations-endpoint.json');
    const startingEndpoint = path.join(dataDir, 'operations-endpoint.starting.json');
    await fs.rm(startingEndpoint, { force: true });
    await fs.rm(endpointFile, { force: true });
    const log = await createLogStream(logFile);
    this.logClosed = new Promise(resolve => {
      log.once('finish', resolve);
      log.once('error', error => { console.error('[server log]', error); resolve(); });
    });
    if (this.stopping) {
      log.end();
      await this.logClosed;
      throw new Error('本地服务启动已取消');
    }
    const startedAt = Date.now();
    log.write(`\n[desktop] starting server at ${new Date(startedAt).toISOString()}\n`);
    const child = this.child = spawn(executable, [entry], {
      env: { ...env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true,
    });
    let failure: Error | undefined;
    let ready = false;
    child.stdout?.pipe(log, { end: false });
    child.stderr?.pipe(log, { end: false });
    child.on('error', error => { failure = error; });
    child.on('exit', (code, signal) => {
      failure = new Error(`本地服务已退出 (code=${code}, signal=${signal})\n日志 ${logFile}`);
      if (ready && !this.stopping) this.options.onExit(failure);
    });
    child.on('close', () => log.end());
    let deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      if (failure) throw failure;
      try {
        const endpoint = JSON.parse(await fs.readFile(startingEndpoint, 'utf8').catch(() => fs.readFile(endpointFile, 'utf8')));
        const url = new URL(endpoint.url);
        if (endpoint.protocol !== 1 || endpoint.pid !== child.pid || url.protocol !== 'http:' || url.hostname !== '127.0.0.1')
          throw new Error('无效本地服务端点');
        const response = await fetch(new URL('/healthz', url), { signal: AbortSignal.timeout(1500) });
        const health = await response.json() as { ok?: boolean; pid?: number };
        if (health.pid === child.pid) {
          deadline = Date.now() + 120_000;
          if (response.ok && health.ok) {
            ready = true;
            log.write(`[desktop] server healthy after ${Date.now() - startedAt}ms\n`);
            return Number(url.port);
          }
        }
      } catch { /* Endpoint is published atomically once the listener exists. */ }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw failure ?? new Error(`本地服务两分钟未响应\n日志 ${logFile}`);
  }

  stop(): Promise<void> {
    return this.stopped ??= this.stopChild().catch(error => { this.stopped = undefined; throw error; });
  }

  private async stopChild(): Promise<void> {
    this.stopping = true;
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode != null || !child.pid) { await this.logClosed; return; }
    await new Promise<void>((resolve, reject) => {
      const force = setTimeout(() => child.kill('SIGKILL'), 15_000);
      const timeout = setTimeout(() => finish(new Error('本地服务无法停止')), 20_000);
      const finish = (error?: Error) => {
        clearTimeout(force);
        clearTimeout(timeout);
        child.removeListener('close', closed);
        if (error) reject(error); else resolve();
      };
      const closed = () => finish();
      child.once('close', closed);
      if (child.connected) child.send({ type: 'shutdown' }, error => { if (error) child.kill(); });
      else child.kill();
    });
    await this.logClosed;
  }
}
