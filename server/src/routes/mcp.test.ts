import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { mcpRouter } from './mcp.js';
import { requireLocal } from '../middleware/localAccess.js';

let listener: Server | undefined;
afterEach(async () => {
  if (listener) await new Promise<void>((resolve, reject) => listener!.close(error => error ? reject(error) : resolve()));
  listener = undefined;
});
async function app() {
  const server = express(); server.use(requireLocal, express.json());
  server.post('/api/operations/call', (req, res) => res.json({ fixture: req.body }));
  server.use(mcpRouter);
  server.get('*', (_req, res) => res.type('html').send('<!doctype html><title>SPA</title>'));
  listener = server.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => listener!.once('listening', resolve));
  const url = `http://127.0.0.1:${(listener.address() as { port: number }).port}`;
  const call = (method: string, params?: unknown) => fetch(url + '/mcp', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).then(res => res.json() as Promise<{ result: Record<string, any> }>);
  return { url, call };
}
describe('built-in Streamable HTTP MCP', () => {
  it('initializes, discovers the shared seven tools and dispatches to this exact instance', async () => {
    const { call } = await app();
    const init = await call('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'fixture', version: '1' } });
    expect(init.result.serverInfo.name).toBe('webobsidian-native');
    const tools = await call('tools/list');
    expect(tools.result.tools).toHaveLength(7);
    expect(tools.result.tools.some((tool: any) => /accept|restore/.test(tool.name))).toBe(false);
    const read = await call('tools/call', { name: 'obsidian_read_file', arguments: { path: 'fixture.md' } });
    expect(read.result.structuredContent.fixture).toEqual({ name: 'obsidian_read_file',
      arguments: { path: 'fixture.md', start_line: 1, line_count: 200 } });
  });
  it('returns discovery 404 before SPA fallback without advertising OAuth', async () => {
    const { url } = await app();
    for (const route of ['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-authorization-server', '/.well-known/oauth-authorization-server/mcp']) {
      const response = await fetch(url + route);
      expect(response.status).toBe(404);
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(await response.json()).toEqual({ error: 'not_found' });
    }
    expect(await (await fetch(url + '/notes')).text()).toContain('<!doctype html>');
  });
  it('retains local access restrictions and rejects unsupported transports', async () => {
    const { url } = await app();
    expect((await fetch(url + '/mcp')).status).toBe(405);
    expect((await fetch(url + '/mcp', { method: 'POST', headers: { Origin: 'https://foreign.example' } })).status).toBe(403);
  });
});
