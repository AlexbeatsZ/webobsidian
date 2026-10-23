import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import { z } from 'zod';

const point = z.object({ line: z.number().int().min(1), ch: z.number().int().min(0) });
const snapshot = z.object({ path: z.string().max(1024), raw: z.string().max(1024 * 1024),
  revision: z.string().optional(), version: z.number().int().min(0), dirty: z.boolean(), saving: z.boolean(), conflict: z.boolean() });
const capture = z.object({ stale: z.boolean(), activePath: z.string().nullable(), interactedAt: z.number(),
  mode: z.string(), cursor: point.nullable(), selections: z.array(z.object({ text: z.string().max(16384),
    kind: z.enum(['source', 'rendered']), from: point.optional(), to: point.optional() })).max(20),
  open: z.array(z.string()).max(100), recent: z.array(z.string()).max(30), document: snapshot.nullable() });
export type WorkspaceCapture = z.infer<typeof capture> & { clientId: string };
type Pending = { client: WebSocket; resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
const clients = new Map<string, WebSocket>();
const pending = new Map<string, Pending>();
const failure = (message: string) => Object.assign(new Error(message), { status: 409 });

/** Reuses the application socket; captures are requested, never streamed while typing. */
export function bindOperationClient(client: WebSocket): void {
  const id = randomUUID();
  clients.set(id, client);
  client.send(JSON.stringify({ type: 'operations-client', clientId: id }));
  client.on('close', () => {
    clients.delete(id);
    for (const [key, call] of pending) if (call.client === client) {
      pending.delete(key); clearTimeout(call.timer); call.reject(failure('工作区连接中断，操作状态需重新核对'));
    }
  });
}
export function operationWorkspaceMessage(client: WebSocket, message: unknown): void {
  const msg = message as { type?: string; id?: string; result?: unknown; error?: string };
  if (msg?.type !== 'operations-response' || !msg.id) return;
  const call = pending.get(msg.id);
  if (!call || call.client !== client) return;
  pending.delete(msg.id); clearTimeout(call.timer);
  if (msg.error) call.reject(failure(String(msg.error).slice(0, 1000)));
  else call.resolve(msg.result);
}
async function ask(clientId: string, kind: string, args: object): Promise<unknown> {
  const client = clients.get(clientId);
  if (!client || client.readyState !== 1) throw failure('请在本体中打开笔记后重试');
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(failure('工作区未响应；未确认操作结果')); }, 15000);
    pending.set(id, { client, resolve, reject, timer });
    try { client.send(JSON.stringify({ type: 'operations-request', id, kind, args })); }
    catch (error) { pending.delete(id); clearTimeout(timer); reject(error); }
  });
}
export async function captureWorkspaces(path?: string): Promise<WorkspaceCapture[]> {
  const ids = [...clients.keys()];
  // Any nonresponding client may own a divergent draft. Do not silently ignore it.
  return Promise.all(ids.map(async clientId => ({ ...capture.parse(await ask(clientId, 'capture', { path })), clientId })));
}
export async function applyInWorkspace(clientId: string, expected: NonNullable<WorkspaceCapture['document']>, raw: string): Promise<void> {
  const result = z.object({ saved: z.literal(true) }).parse(await ask(clientId, 'apply', { expected, raw }));
  if (!result.saved) throw failure('文档尚未保存');
}
