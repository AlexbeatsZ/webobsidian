import { Router } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createNativeMcpServer } from '../operations/mcpServer.js';
import { asyncHandler } from '../middleware/error.js';

// Stateless MCP shares the existing loopback listener and local-access guard.
export const mcpRouter = Router();
mcpRouter.post('/', asyncHandler(async (req, res) => {
  const server = createNativeMcpServer(`http://127.0.0.1:${req.socket.localPort}`);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.once('close', () => { void server.close().catch(error => console.error('[MCP close]', error)); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}));
mcpRouter.all('/', (_req, res) => {
  res.status(405).setHeader('Allow', 'POST');
  res.json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Method not allowed' } });
});
