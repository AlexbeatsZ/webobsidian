import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request, RequestHandler } from 'express';
import type { WebSocket } from 'ws';
import { vaultConfigurationIdentity } from './vaultConfiguration.js';

let epoch = 0;
let activeWrites = 0;
let clients: () => Iterable<WebSocket> = () => [];
type Lease = { token: string; failure?: string; checks: Map<WebSocket, { id: string; blockers?: string[] }> };
let lease: Lease | undefined;
let inspection: Lease | undefined;
const conflict = (message: string) => Object.assign(new Error(message), { status: 409 });
const operations = new AsyncLocalStorage<{ active: boolean; vault?: string }>();
const requestPath = (req: Request) => (req.originalUrl || req.url).split('?')[0].replace(/\/$/, '');
const readOnlyRequest = (req: Request) => ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ||
  req.method === 'POST' && ['/api/attachments/scan', '/api/tags/preview', '/api/search/matches'].includes(requestPath(req));
const exclusiveRequest = (req: Request) => req.method === 'POST' && requestPath(req) === '/api/attachments/execute' ||
  req.method === 'PUT' && requestPath(req) === '/api/settings' && typeof req.body?.vault?.path === 'string';

export async function assertVaultIdentity(expected: string): Promise<void> {
  if (expected !== (await vaultConfigurationIdentity()).vault)
    throw Object.assign(conflict('Vault 已切换，请重新加载应用；旧文档会话保留'), { code: 'VAULT_CHANGED' });
}

export async function withVaultRequest<T>(req: Request, work: () => Promise<T>): Promise<T> {
  if (!requestPath(req).startsWith('/api/')) return work();
  const supplied = req.get('X-Vault-Identity') ?? req.query.vault;
  const expected = typeof supplied === 'string' ? supplied : undefined;
  if (requestPath(req).startsWith('/api/files') && !expected)
    throw Object.assign(conflict('缺少 Vault 身份，请重新加载应用'), { code: 'VAULT_CHANGED' });
  const exclusive = exclusiveRequest(req);
  if (lease) throw conflict('正在维护仓库，请稍后重试');
  const release = exclusive ? () => {} : beginOperation(!readOnlyRequest(req));
  const operation = { active: !exclusive, vault: expected };
  try {
    return await operations.run(operation, async () => {
      if (expected !== undefined) await assertVaultIdentity(expected);
      return work();
    });
  } finally { operation.active = false; release(); }
}

export const vaultGeneration = () => String(epoch);
export function noteVaultMutation(): void { epoch++; }
export function bindMaintenanceClients(getClients: () => Iterable<WebSocket>): void { clients = getClients; }
export function maintenanceClientConnected(): void {
  if (lease) lease.failure = '清理期间出现新的应用连接，请重新扫描';
}
export function maintenanceClientMessage(client: WebSocket, message: unknown): void {
  const msg = message as { type?: string; token?: string; check?: string; blockers?: unknown };
  const current = msg?.token === lease?.token ? lease : inspection;
  const pending = current?.checks.get(client);
  if (!pending || msg?.type !== 'maintenance-ack' || msg.token !== current?.token || msg.check !== pending.id) return;
  if (!Array.isArray(msg.blockers) || msg.blockers.some(value => typeof value !== 'string')) return;
  pending.blockers = msg.blockers.slice(0, 30).map(value => String(value).slice(0, 300));
}

export const guardVaultMutations: RequestHandler = (req, res, next) => {
  const readOnlyPost = req.method === 'POST' && ['/api/attachments/scan', '/api/tags/preview', '/api/search/matches'].includes(req.path);
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || readOnlyPost || req.path === '/api/attachments/execute') {
    next(); return;
  }
  if (lease) { res.status(409).json({ error: '正在复查和清理附件，请稍后保存' }); return; }
  next();
};

/** Background Git shares the maintenance writer gate with incoming HTTP writes. */
export function beginBackgroundVaultWrite(): () => void {
  const operation = operations.getStore();
  return beginOperation(true, !!operation?.active);
}

function beginOperation(mutates: boolean, admitted = false): () => void {
  if (lease && !admitted) throw conflict('正在复查和清理附件，后台同步稍后重试');
  activeWrites++;
  if (mutates) noteVaultMutation();
  let released = false;
  return () => { if (!released) { released = true; activeWrites--; if (mutates) noteVaultMutation(); } };
}

const pause = () => new Promise<void>(resolve => setTimeout(resolve, 20));

async function checkWorkspace(current: Lease, freeze: boolean): Promise<string[]> {
  if (current.failure) throw conflict(current.failure);
  const connected = [...clients()];
  if (!connected.length) throw conflict('没有可确认编辑状态的应用连接');
  if (connected.some(client => client.readyState !== 1)) throw conflict('应用连接状态未知');
  const check = randomUUID();
  current.checks = new Map(connected.map(client => [client, { id: check }]));
  for (const client of connected) client.send(JSON.stringify({ type: 'maintenance', phase: freeze ? 'prepare' : 'inspect', token: current.token, check }));
  const deadline = Date.now() + 5000;
  while ([...current.checks.values()].some(state => state.blockers === undefined)) {
    if (current.failure || connected.some(client => client.readyState !== 1))
      throw conflict(current.failure ?? '应用连接中断，清理已停止');
    if (Date.now() > deadline) throw conflict('有应用窗口未确认编辑状态，请关闭旧窗口或重新连接');
    await pause();
  }
  if (current.failure || connected.some(client => client.readyState !== 1))
    throw conflict(current.failure ?? '应用连接中断，清理已停止');
  return [...new Set([...current.checks.values()].flatMap(state => state.blockers ?? []))];
}

export async function inspectMaintenanceWorkspace(): Promise<string[]> {
  if (lease) return checkWorkspace(lease, true);
  if (inspection) return ['另一个扫描正在确认编辑状态，请稍后重试'];
  const current: Lease = { token: randomUUID(), checks: new Map() };
  inspection = current;
  try { return await checkWorkspace(current, false); }
  catch (error) { return [error instanceof Error ? error.message : String(error)]; }
  finally { if (inspection === current) inspection = undefined; }
}

export async function assertMaintenanceWorkspaceSafe(): Promise<void> {
  if (!lease) throw conflict('附件清理必须持有编辑暂停许可');
  const blockers = await checkWorkspace(lease, true);
  if (blockers.length) throw conflict(blockers.join('；'));
}

export async function withVaultMaintenance<T>(drainUpdates: () => Promise<void>, work: () => Promise<T>): Promise<T> {
  if (lease) throw conflict('已有附件清理正在执行');
  const current: Lease = { token: randomUUID(), checks: new Map() };
  lease = current;
  try {
    const deadline = Date.now() + 10000;
    while (activeWrites) {
      if (Date.now() > deadline) throw conflict('仍有写入请求未完成，请稍后重新扫描');
      await pause();
    }
    const expected = operations.getStore()?.vault;
    if (expected !== undefined) await assertVaultIdentity(expected);
    await drainUpdates();
    await assertMaintenanceWorkspaceSafe();
    return await work();
  } finally {
    if (lease === current) lease = undefined;
    for (const client of clients())
      if (client.readyState === 1) {
        try { client.send(JSON.stringify({ type: 'maintenance', phase: 'release', token: current.token })); }
        catch { /* A closed socket releases the client UI through its close event. */ }
      }
  }
}
