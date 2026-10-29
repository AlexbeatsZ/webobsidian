import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { McpLauncher } from '../../../desktop/src/mcpLauncher';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));
const fixtures: string[] = [];
afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(fixtures.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })));
});

async function project() {
  const parent = path.join(os.tmpdir(), '.agents');
  await fs.mkdir(parent, { recursive: true });
  const directory = await fs.mkdtemp(path.join(parent, "mcp launcher ' test-"));
  fixtures.push(directory);
  await fs.mkdir(path.join(directory, 'scripts'));
  await fs.writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: 'obsidian-context-mcp' }));
  await fs.writeFile(path.join(directory, 'scripts', 'manual-start-mcp.ps1'), 'exit 0');
  return directory;
}

function complete(error: Error | null, stdout = '', stderr = '') {
  const callback = vi.mocked(execFile).mock.calls.at(-1)![3] as unknown as (error: Error | null, stdout: string, stderr: string) => void;
  callback(error, stdout, stderr);
}

describe('native MCP manual launcher', () => {
  it('inspects without running a command and rejects unrelated projects or missing entries', async () => {
    const directory = await project(), launcher = new McpLauncher();
    expect(await launcher.inspect(directory)).toEqual({ projectPath: directory, configured: true });
    await fs.writeFile(path.join(directory, 'package.json'), '{"name":"other"}');
    expect((await launcher.inspect(directory)).configured).toBe(false);
    expect((await launcher.inspect(path.join(directory, 'missing'))).configured).toBe(false);
    expect(execFile).not.toHaveBeenCalled();
  });

  it.skipIf(process.platform !== 'win32')('rejects a missing project without executing commands', async () => {
    const launcher = new McpLauncher();
    await expect(launcher.connect('missing', 'endpoint')).rejects.toThrow('请选择');
    expect(execFile).not.toHaveBeenCalled();
  });

  it.skipIf(process.platform !== 'win32')('passes fixed encoded script and literal paths via environment, then returns UTF-8 output', async () => {
    const directory = await project(), endpoint = path.join(directory, "app's data", 'operations-endpoint.json');
    const running = new McpLauncher().connect(directory, endpoint);
    await vi.waitFor(() => expect(execFile).toHaveBeenCalledOnce());
    const [executable, args, options] = vi.mocked(execFile).mock.calls[0] as unknown as [string, string[], { cwd: string; windowsHide: boolean; timeout: number; maxBuffer: number; env: NodeJS.ProcessEnv }];
    expect(executable).toMatch(/System32.*powershell.exe$/);
    expect(args).toContain('Hidden');
    const command = Buffer.from(args.at(-1)!, 'base64').toString('utf16le');
    expect(command).toContain('$env:WEBOBSIDIAN_MCP_MANUAL');
    expect(command).toContain('$ProgressPreference = "SilentlyContinue"');
    expect(command).toContain('*>&1 | ForEach-Object');
    expect(command).not.toContain(directory);
    expect(command).not.toContain('LaunchApp');
    expect(options).toMatchObject({ cwd: directory, windowsHide: true, timeout: 60000, maxBuffer: 32768,
      env: { WEBOBSIDIAN_MCP_ACTION: 'Connect', WEBOBSIDIAN_MCP_ENDPOINT: endpoint } });
    complete(null, '已启动\n');
    expect(await running).toMatchObject({ ok: true, output: '已启动' });
  });

  it.skipIf(process.platform !== 'win32')('serializes every action and releases ownership after failure', async () => {
    const directory = await project(), launcher = new McpLauncher();
    const running = launcher.connect(directory, 'endpoint');
    await expect(launcher.connect(directory, 'endpoint')).rejects.toThrow('进行');
    await vi.waitFor(() => expect(execFile).toHaveBeenCalledOnce());
    complete(new Error('exit 1'), 'preflight', 'offline');
    expect(await running).toMatchObject({ ok: false, output: 'preflight\noffline' });
    const checking = launcher.connect(directory, 'endpoint');
    await vi.waitFor(() => expect(execFile).toHaveBeenCalledTimes(2));
    complete(null, 'ready');
    expect(await checking).toMatchObject({ ok: true, output: 'ready' });
  });

  it.skipIf(process.platform !== 'win32')('reports bounded-command timeouts instead of claiming startup succeeded', async () => {
    const directory = await project();
    const running = new McpLauncher().connect(directory, 'endpoint');
    await vi.waitFor(() => expect(execFile).toHaveBeenCalledOnce());
    complete(Object.assign(new Error('timeout'), { killed: true }));
    expect(await running).toMatchObject({ ok: false, output: expect.stringContaining('超时') });
  });
});
