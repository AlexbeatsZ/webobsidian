import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { McpLauncher } from '../../../desktop/src/mcpLauncher';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
const fixtures: string[] = [];
afterEach(async () => {
  vi.clearAllMocks(); vi.unstubAllGlobals();
  await Promise.all(fixtures.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })));
});
async function fixture() {
  const parent = path.join(os.tmpdir(), '.agents');
  await fs.mkdir(parent, { recursive: true });
  const directory = await fs.mkdtemp(path.join(parent, "mcp built-in ' test-")); fixtures.push(directory);
  const binary = path.join(directory, 'tunnel-client'), mcpEntry = path.join(directory, 'mcp.cjs');
  await fs.writeFile(binary, 'fixture'); await fs.writeFile(mcpEntry, 'fixture');
  const secrets = { isEncryptionAvailable: () => true, encryptString: (text: string) => Buffer.from(`encrypted:${text}`),
    decryptString: (bytes: Buffer) => bytes.toString().slice('encrypted:'.length) };
  const options = { runtimeDir: path.join(directory, 'state'), binary, mcpEntry, executable: 'WebObsidian',
    endpointFile: path.join(directory, 'operations-endpoint.json'), serverUrl: 'http://127.0.0.1:18787', secrets };
  return { directory, options, launcher: new McpLauncher(options) };
}
function child() {
  const value = Object.assign(new EventEmitter(), {
    pid: 123, exitCode: null as number | null, killed: false,
    stdout: new EventEmitter(), stderr: new EventEmitter(),
    kill() { this.killed = true; this.exitCode = 0; queueMicrotask(() => value.emit('close', 0)); return true; },
  });
  return value;
}
describe('bundled MCP connection owner', () => {
  it('discovers bundled components without a project, Node or process execution', async () => {
    const { launcher, options } = await fixture();
    const state = await launcher.inspect();
    expect(state).toMatchObject({ available: true, hasKey: false, tunnelId: '', connected: false });
    const config = JSON.parse(state.clientConfig).mcpServers.webobsidian;
    expect(config).toEqual({ command: 'WebObsidian', args: [options.mcpEntry],
      env: { ELECTRON_RUN_AS_NODE: '1', WEBOBSIDIAN_ENDPOINT_FILE: options.endpointFile } });
    expect(spawn).not.toHaveBeenCalled();
    await fs.rm(options.mcpEntry);
    expect((await launcher.inspect()).available).toBe(false);
  });
  it('encrypts credentials, keeps blank keys, rejects invalid config and never returns secrets', async () => {
    const { launcher, options } = await fixture();
    await expect(launcher.configure({ tunnelId: '../bad', apiKey: 'secret' })).rejects.toThrow('Tunnel ID');
    await expect(launcher.configure({ tunnelId: 'tunnel_fixture123' })).rejects.toThrow('运行密钥');
    const state = await launcher.configure({ tunnelId: 'tunnel_fixture123', apiKey: 'fixture-secret' });
    expect(JSON.stringify(state)).not.toContain('fixture-secret');
    const saved = await fs.readFile(path.join(options.runtimeDir, 'connection.json'), 'utf8');
    expect(saved).not.toContain('fixture-secret');
    await launcher.configure({ tunnelId: 'tunnel_fixture456' });
    expect(JSON.parse(await fs.readFile(path.join(options.runtimeDir, 'connection.json'), 'utf8')).encryptedKey)
      .toBe(JSON.parse(saved).encryptedKey);
    expect(spawn).not.toHaveBeenCalled();
  });
  it('fails closed when the OS cannot protect a new key', async () => {
    const { options } = await fixture();
    options.secrets.isEncryptionAvailable = () => false;
    await expect(new McpLauncher(options).configure({ tunnelId: 'tunnel_fixture123', apiKey: 'secret' })).rejects.toThrow('密钥存储');
  });
  it('keeps healthy runtime, serializes clicks and stops only its own child', async () => {
    const { launcher, options } = await fixture();
    await launcher.configure({ tunnelId: 'tunnel_fixture123', apiKey: 'fixture-secret' });
    const runtime = child();
    vi.mocked(spawn).mockImplementationOnce((() => {
      void fs.writeFile(path.join(options.runtimeDir, 'health.url'), 'http://127.0.0.1:19999');
      return runtime;
    }) as any);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
    const connecting = launcher.connect();
    await expect(launcher.connect()).rejects.toThrow('进行');
    expect(await connecting).toMatchObject({ ok: true, connected: true });
    expect(spawn).toHaveBeenCalledOnce();
    const [binary, args, spawnOptions] = vi.mocked(spawn).mock.calls[0] as any;
    expect(binary).toBe(options.binary);
    expect(args).toContain('http://127.0.0.1:18787/mcp');
    expect(args.join(' ')).not.toContain('fixture-secret');
    expect(spawnOptions.env.CONTROL_PLANE_API_KEY).toBe('fixture-secret');
    expect(await launcher.connect()).toMatchObject({ ok: true, connected: true });
    expect(spawn).toHaveBeenCalledOnce();
    await launcher.stop();
    expect(runtime.killed).toBe(true);
    expect((await launcher.inspect()).connected).toBe(false);
  });
  it('reports child failure with bounded redacted output and permits a manual retry', async () => {
    const { launcher } = await fixture();
    await launcher.configure({ tunnelId: 'tunnel_fixture123', apiKey: 'fixture-secret' });
    const runtime = child();
    vi.mocked(spawn).mockImplementationOnce((() => {
      queueMicrotask(() => { runtime.stderr.emit('data', Buffer.from('bad fixture-secret')); runtime.exitCode = 1; });
      return runtime;
    }) as any);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
    const result = await launcher.connect();
    expect(result).toMatchObject({ ok: false, connected: false, output: expect.stringContaining('[redacted]') });
    expect(result.output).not.toContain('fixture-secret');
    expect((await launcher.connect()).ok).toBe(false);
  });
});
