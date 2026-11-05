import { Router } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createNativeMcpServer } from '../operations/mcpServer.js';
import { mcpInstructionNotes } from '../services/operations.js';
import { asyncHandler } from '../middleware/error.js';

// Stateless MCP shares the existing loopback listener and local-access guard.
export const mcpRouter = Router();
// No OAuth is provided locally; discovery must not fall through to SPA HTML.
mcpRouter.all(/^\/\.well-known\/(?:oauth-protected-resource|oauth-authorization-server)(?:\/.*)?$/, (_req, res) => {
  res.status(404).json({ error: 'not_found' });
});
mcpRouter.post('/mcp', asyncHandler(async (req, res) => {
  const notes = await mcpInstructionNotes(false).catch(() => []);
  const server = createNativeMcpServer(`http://127.0.0.1:${req.socket.localPort}`, notes);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.once('close', () => { void server.close().catch(error => console.error('[MCP close]', error)); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}));
mcpRouter.all('/mcp', (_req, res) => {
  res.status(405).setHeader('Allow', 'POST');
  res.json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Method not allowed' } });
});
