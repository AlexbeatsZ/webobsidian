import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';
import { McpLauncher } from '../../../desktop/src/mcpLauncher';

const sourceFile = fileURLToPath(new URL('../../../desktop/src/main.ts', import.meta.url));
const nativeRequire = createRequire(import.meta.url);
const compiled = transpileModule(readFileSync(sourceFile, 'utf8'), {
  compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;

function fixture(platform = 'win32') {
  vi.useFakeTimers();
  const application = Object.assign(new EventEmitter(), {
    requestSingleInstanceLock: () => true,
    whenReady: () => new Promise<void>(() => {}),
    quit: vi.fn(),
    isPackaged: false,
  });
  const ipc = Object.assign(new EventEmitter(), { handle: vi.fn() });
  const scripts = { stop: vi.fn().mockResolvedValue(undefined) };
  const server = { kill: vi.fn() };
  const showErrorBox = vi.fn();
  let window!: FakeWindow;
  class FakeWindow extends EventEmitter {
    vetoUnload = false;
    destroyed = false;
    url = 'http://127.0.0.1:8787/';
    webContents = Object.assign(new EventEmitter(), {
      mainFrame: { url: this.url },
      getURL: () => this.url,
      send: vi.fn(),
      setWindowOpenHandler: vi.fn(),
    });
    close = vi.fn(() => {
      const event = { preventDefault: vi.fn() };
      this.emit('close', event);
      if (event.preventDefault.mock.calls.length) return;
      if (this.vetoUnload) { this.webContents.emit('will-prevent-unload'); return; }
      this.destroyed = true;
      this.emit('closed');
    });
    show = vi.fn();
    constructor() { super(); window = this; }
    isDestroyed() { return this.destroyed; }
    setMenuBarVisibility() {}
    isFullScreen() { return false; }
    loadURL(url: string) { this.url = url; this.webContents.mainFrame.url = url; return Promise.resolve(); }
  }
  const moduleExports: Record<string, any> = {};
  const electron = { app: application, BrowserWindow: FakeWindow, ipcMain: ipc, dialog: { showErrorBox } };
  runInNewContext(compiled + '\nexports.fixture = { createWindow, requestWindowClose, initialize: (scripts, server) => { serverPort = 8787; userscripts = scripts; serverProc = server; registerDesktopRequests(); } };', {
    exports: moduleExports,
    require: (id: string) => id === 'electron' ? electron : id === './mcpLauncher' ? { McpLauncher } : id === './userscripts/service' || id === './paths' ? {} : nativeRequire(id),
    process: { platform },
    __dirname: fileURLToPath(new URL('../../../desktop/src', import.meta.url)),
    URL, Buffer, setTimeout, clearTimeout, console,
  });
  moduleExports.fixture.initialize(scripts, server);
  moduleExports.fixture.createWindow();
  const token = () => window.webContents.send.mock.calls.filter(call => call[0] === 'desktop:prepare-close').at(-1)![1];
  const reply = (result: { ok: boolean; error?: string }, requestedToken = token(), guest = false) => {
    const sender = guest ? { mainFrame: window.webContents.mainFrame } : window.webContents;
    ipc.emit('desktop:close-result', { sender, senderFrame: window.webContents.mainFrame }, requestedToken, result);
  };
  return { application, window, scripts, server, showErrorBox, token, reply,
    invoke: (channel: string, event: unknown, ...args: unknown[]) => ipc.handle.mock.calls.find(call => call[0] === channel)![1](event, ...args),
    close: (quit: boolean) => moduleExports.fixture.requestWindowClose(window, quit) as Promise<void> };
}

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('desktop close coordinator against the production main implementation', () => {
  it('rejects MCP IPC from guests, subframes and nonlocal origins before any operation', async () => {
    const host = fixture();
    const frame = host.window.webContents.mainFrame;
    const denied = [
      { sender: {}, senderFrame: frame },
      { sender: host.window.webContents, senderFrame: { url: frame.url } },
      { sender: host.window.webContents, senderFrame: null },
    ];
    for (const event of denied) for (const channel of ['desktop:mcp-inspect', 'desktop:mcp-connect', 'desktop:mcp-select-project']) {
      await expect(host.invoke(channel, event, 'Start')).rejects.toThrow('Local application frame');
    }
    frame.url = 'https://untrusted.example/';
    await expect(host.invoke('desktop:mcp-connect', { sender: host.window.webContents, senderFrame: frame })).rejects.toThrow('Local application frame');
  });
  it('intercepts the native close, ignores stale or guest replies and keeps the server until will-quit', async () => {
    const host = fixture();
    let finishScripts!: () => void;
    host.scripts.stop.mockReturnValueOnce(new Promise<void>(resolve => { finishScripts = resolve; }));
    host.window.close();
    const closing = host.close(true);
    expect(host.window.destroyed).toBe(false);
    expect(host.application.quit).not.toHaveBeenCalled();
    host.reply({ ok: true }, 'stale');
    host.reply({ ok: true }, host.token(), true);
    await vi.advanceTimersByTimeAsync(0);
    expect(host.scripts.stop).not.toHaveBeenCalled();
    host.reply({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(host.scripts.stop).toHaveBeenCalledOnce();
    expect(host.application.quit).not.toHaveBeenCalled();
    finishScripts();
    await closing;
    expect(host.application.quit).toHaveBeenCalledOnce();
    expect(host.server.kill).not.toHaveBeenCalled();
    host.application.emit('will-quit');
    expect(host.server.kill).toHaveBeenCalledOnce();
  });

  it('retains the window and service on a failed save, then accepts a fresh close attempt', async () => {
    const host = fixture();
    const failing = host.close(true);
    const oldToken = host.token();
    host.reply({ ok: false, error: 'disk full' });
    await failing;
    expect(host.window.destroyed).toBe(false);
    expect(host.application.quit).not.toHaveBeenCalled();
    expect(host.scripts.stop).not.toHaveBeenCalled();
    expect(host.showErrorBox).toHaveBeenCalledWith('无法关闭 WebObsidian', expect.stringContaining('disk full'));
    const retry = host.close(true);
    expect(host.token()).not.toBe(oldToken);
    host.reply({ ok: true }, oldToken);
    expect(host.application.quit).not.toHaveBeenCalled();
    host.reply({ ok: true });
    await retry;
    expect(host.application.quit).toHaveBeenCalledOnce();
  });

  it('cancels a timed-out close and ignores the late successful save acknowledgement', async () => {
    const host = fixture();
    const closing = host.close(true);
    const token = host.token();
    await vi.advanceTimersByTimeAsync(30_000);
    await closing;
    expect(host.application.quit).not.toHaveBeenCalled();
    expect(host.window.webContents.send.mock.calls.some(call => call[0] === 'desktop:close-cancelled')).toBe(true);
    host.reply({ ok: true }, token);
    await vi.advanceTimersByTimeAsync(0);
    expect(host.application.quit).not.toHaveBeenCalled();
  });

  it('routes Cmd-Q through the same acknowledgement barrier while the renderer is still alive', async () => {
    const host = fixture('darwin');
    const event = { preventDefault: vi.fn() };
    host.application.emit('before-quit', event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(host.window.destroyed).toBe(false);
    expect(host.server.kill).not.toHaveBeenCalled();
    const closing = host.close(true);
    host.reply({ ok: true });
    await closing;
    expect(host.application.quit).toHaveBeenCalledOnce();
  });

  it('closes a macOS window normally after saving without stopping the background application', async () => {
    const host = fixture('darwin');
    host.window.close();
    const closing = host.close(false);
    host.reply({ ok: true });
    await closing;
    expect(host.window.destroyed).toBe(true);
    expect(host.scripts.stop).not.toHaveBeenCalled();
    expect(host.application.quit).not.toHaveBeenCalled();
    expect(host.server.kill).not.toHaveBeenCalled();
  });

  it('keeps a normal unload veto effective and requires another acknowledgement next time', async () => {
    const host = fixture('darwin');
    host.window.vetoUnload = true;
    const closing = host.close(false);
    host.reply({ ok: true });
    await closing;
    expect(host.window.destroyed).toBe(false);
    const oldToken = host.token();
    host.window.vetoUnload = false;
    const retry = host.close(false);
    expect(host.token()).not.toBe(oldToken);
    host.reply({ ok: true });
    await retry;
    expect(host.window.destroyed).toBe(true);
  });

  it('retains the window and releases the renderer when userscript shutdown fails', async () => {
    const host = fixture();
    host.scripts.stop.mockRejectedValueOnce(new Error('shutdown failure'));
    const closing = host.close(true);
    host.reply({ ok: true });
    await closing;
    expect(host.application.quit).not.toHaveBeenCalled();
    expect(host.window.destroyed).toBe(false);
    expect(host.window.webContents.send.mock.calls.some(call => call[0] === 'desktop:close-cancelled')).toBe(true);
    expect(host.server.kill).not.toHaveBeenCalled();
  });

  it('upgrades a pending macOS window close to Cmd-Q without starting a second save request', async () => {
    const host = fixture('darwin');
    host.window.close();
    const event = { preventDefault: vi.fn() };
    host.application.emit('before-quit', event);
    const closing = host.close(true);
    expect(host.window.webContents.send.mock.calls.filter(call => call[0] === 'desktop:prepare-close')).toHaveLength(1);
    host.reply({ ok: true });
    await closing;
    expect(host.scripts.stop).toHaveBeenCalledOnce();
    expect(host.application.quit).toHaveBeenCalledOnce();
  });
});
