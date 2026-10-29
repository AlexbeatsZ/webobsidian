import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { isIP } from 'node:net';
import { prefix, defaultPort, validateManifest } from '../../../sync-server/protocol.mjs';
import type { SyncManifest, SyncOperation } from '../contracts/fileSync.js';

export function normalizeSyncEndpoint(value: string): string {
  const raw = value.trim();
  const address = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
  const url = new URL(address);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error('同步地址必须是无凭据的 HTTP/HTTPS 地址');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (url.protocol === 'http:') {
    const parts = hostname.split('.').map(Number);
    const privateIp = isIP(hostname) === 4 && (parts[0] === 10 || parts[0] === 127 ||
      parts[0] === 192 && parts[1] === 168 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31 ||
      parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127);
    const privateV6 = isIP(hostname) === 6 && (hostname === '::1' || /^(fc|fd)/i.test(hostname));
    if (!privateIp && !privateV6 && hostname !== 'localhost') throw new Error('公网同步地址必须使用 HTTPS');
  }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) && !/:\d+$/.test(raw.split('/')[0])) url.port = String(defaultPort);
  if (url.pathname === '/') url.pathname = `${prefix}/`;
  if (url.pathname !== `${prefix}/` && url.pathname !== prefix) throw new Error(`同步地址路径应为 ${prefix}/`);
  url.pathname = `${prefix}/`;
  return url.href;
}

export class SyncHttpError extends Error {
  constructor(readonly status: number, readonly details: unknown) { super(`同步服务返回 ${status}`); }
}

export async function syncJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('同步服务未返回数据');
  const chunks: Buffer[] = []; let length = 0;
  for await (const chunk of Readable.fromWeb(response.body as never)) {
    length += chunk.length;
    if (length > 32 * 1024 * 1024) throw new Error('同步清单超过大小限制');
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export class OrderedSyncTransport {
  readonly endpoints: string[];
  selected: string | null = null;
  constructor(endpoints: string[], private readonly token: string, private readonly probeTimeoutMs = 5000) {
    if (!endpoints.length) throw new Error('请至少填写一个同步地址');
    if (!/^[\x21-\x7e]{32,512}$/.test(token)) throw new Error('访问令牌需要 32–512 个 ASCII 字符');
    this.endpoints = endpoints.map(normalizeSyncEndpoint);
  }

  async select(expected?: { workspaceId: string; revision: number }): Promise<SyncManifest> {
    this.selected = null;
    for (const endpoint of this.endpoints) {
      let response: Response;
      try {
        response = await fetch(`${endpoint}manifest`, { redirect: 'error', headers: { Authorization: `Bearer ${this.token}` }, signal: AbortSignal.timeout(this.probeTimeoutMs) });
      } catch (error) {
        if (error instanceof TypeError || ['TimeoutError', 'AbortError'].includes((error as Error).name)) continue;
        throw error;
      }
      if ([502, 503, 504].includes(response.status)) { await response.body?.cancel(); continue; }
      if (!response.ok) throw new SyncHttpError(response.status, await syncJson(response));
      let manifest: unknown;
      try { manifest = await syncJson(response); }
      catch (error) {
        if (error instanceof TypeError || ['TimeoutError', 'AbortError'].includes((error as Error).name)) continue;
        throw error;
      }
      validateManifest(manifest);
      if (expected && (manifest.workspaceId !== expected.workspaceId || manifest.revision < expected.revision))
        throw new Error('同步地址的数据身份不一致或版本回退，已停止以保护笔记');
      this.selected = endpoint;
      return manifest;
    }
    throw new Error('所有同步地址均不可用；本机修改已保留');
  }

  async request(resource: string, options: RequestInit & { duplex?: string } = {}): Promise<Response> {
    if (!this.selected) throw new Error('尚未连接同步服务');
    const response = await fetch(`${this.selected}${resource}`, { ...options, redirect: 'error',
      headers: { ...options.headers, Authorization: `Bearer ${this.token}` }, signal: AbortSignal.timeout(10 * 60 * 1000) });
    if (!response.ok) throw new SyncHttpError(response.status, await syncJson(response));
    return response;
  }

  async upload(hash: string, filename: string): Promise<void> {
    await syncJson(await this.request(`blobs/${hash}`, { method: 'PUT', body: createReadStream(filename) as never, duplex: 'half' }));
  }

  async commit(operation: SyncOperation): Promise<SyncManifest & { operationId: string }> {
    const receipt = await syncJson(await this.request('commit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(operation) }));
    validateManifest(receipt);
    if ((receipt as { operationId?: string }).operationId !== operation.operationId || receipt.workspaceId !== operation.workspaceId ||
        Object.keys(receipt.files).length !== operation.changes.length || operation.changes.some(change => receipt.files[change.path]?.hash !== change.hash ||
          receipt.files[change.path]?.version !== receipt.revision || receipt.files[change.path].version <= change.expectedVersion))
      throw new Error('同步提交回执与本机请求不一致');
    return receipt as SyncManifest & { operationId: string };
  }
}
