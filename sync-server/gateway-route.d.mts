import type { IncomingMessage, ServerResponse } from 'node:http';
export function routeWebObsidian(request: IncomingMessage, response: ServerResponse, options?: { port?: number; maxBlobBytes?: number }): boolean;
