import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createNativeMcpServer, fetchInstructionLinks } from './operations/mcpServer.js';

async function main() {
  for (const key of Object.keys(process.env)) {
    if (/^(CONTROL_PLANE_API_KEY|OPENAI_API_KEY|OPENAI_ADMIN_KEY)$/i.test(key)) delete process.env[key];
  }
  const server = createNativeMcpServer(undefined, await fetchInstructionLinks());
  await server.connect(new StdioServerTransport());
}
main().catch(error => { console.error((error as Error).message); process.exitCode = 1; });
