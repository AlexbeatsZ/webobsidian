import type { Server, IncomingMessage, ServerResponse } from 'node:http';
export function addFileSyncRoute<T extends { server: Server }>(gateway: T, routeMojian: (request: IncomingMessage, response: ServerResponse) => boolean): T;
