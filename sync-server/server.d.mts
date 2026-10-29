import type { Server } from 'node:http';
export function createSyncServer(options: { root: string; token: string; maxBlobBytes?: number }): Promise<{ server: Server; close(): Promise<void> }>;
