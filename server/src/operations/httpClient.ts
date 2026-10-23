import { promises as fs } from 'node:fs';

/** Both CLI and MCP use this transport. It never reads notes or writes a Vault. */
export async function operationBaseUrl(): Promise<string> {
  let url = process.env.WEBOBSIDIAN_URL ?? 'http://127.0.0.1:8787';
  if (process.env.WEBOBSIDIAN_ENDPOINT_FILE) {
    const endpoint = JSON.parse(await fs.readFile(process.env.WEBOBSIDIAN_ENDPOINT_FILE, 'utf8'));
    if (endpoint.protocol !== 1 || typeof endpoint.url !== 'string') throw new Error('无效本体端点文件');
    url = endpoint.url;
  }
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
      || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash)
    throw new Error('操作入口只支持本机 HTTP 根地址');
  return parsed.origin;
}
export async function operationHttp(endpoint: string, body?: unknown): Promise<unknown> {
  const response = await fetch((await operationBaseUrl()) + '/api/operations/' + endpoint,
    { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const value = await response.json() as { error?: string };
  if (!response.ok) throw new Error(value.error ?? `HTTP ${response.status}`);
  return value;
}
