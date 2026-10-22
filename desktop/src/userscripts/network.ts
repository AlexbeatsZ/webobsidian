import { net, type Session } from 'electron';
import { createHash } from 'node:crypto';

export interface FetchResult { status: number; statusText: string; url: string; headers: Record<string, string>; bytes: Buffer }
/** One bounded Electron transport for install, update, assets and GM requests. */
export async function scriptFetch(url: string, options: {
  method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal;
  timeout?: number; maxBytes?: number; allow?: (url: string) => boolean; session?: Session;
  anonymous?: boolean;
} = {}): Promise<FetchResult> {
  if (options.timeout !== undefined && (!Number.isFinite(options.timeout) || options.timeout < 0)) throw new Error('Invalid request timeout');
  const timeout = AbortSignal.timeout(Math.max(1, Math.min(options.timeout || 30000, 120000)));
  const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
  let method = options.method ?? 'GET', body = options.body, headers = { ...options.headers };
  for (let redirect = 0; redirect <= 8; redirect++) {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password || (options.allow && !options.allow(url))) throw new Error('URL denied: ' + parsed.origin);
    const fetcher = options.session ? options.session.fetch.bind(options.session) : net.fetch;
    const response = await fetcher(url, { method, headers, body, signal, redirect: 'manual', credentials: options.anonymous === false ? 'include' : 'omit' });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error('Redirect has no Location');
      const next = new URL(location, url);
      if (next.origin !== parsed.origin) {
        headers = Object.fromEntries(Object.entries(headers).filter(([key]) => !/^(authorization|cookie|proxy-authorization)$/i.test(key)));
      }
      if (response.status === 303 || ([301, 302].includes(response.status) && method === 'POST')) { method = 'GET'; body = undefined; }
      url = next.href;
      continue;
    }
    const max = options.maxBytes ?? 8 * 1024 * 1024;
    if (Number(response.headers.get('content-length')) > max) { await response.body?.cancel(); throw new Error('Response exceeds size limit'); }
    const reader = response.body?.getReader(), chunks: Buffer[] = [];
    let size = 0;
    try {
      if (reader) for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > max) throw new Error('Response exceeds size limit');
        chunks.push(Buffer.from(value));
      }
    } finally { await reader?.cancel().catch(() => {}); }
    const receivedHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => { receivedHeaders[key] = value; });
    return { status: response.status, statusText: response.statusText, url,
      headers: receivedHeaders, bytes: Buffer.concat(chunks) };
  }
  throw new Error('Too many redirects');
}
export function verifyIntegrity(url: string, bytes: Buffer) {
  const hash = new URL(url).hash.slice(1);
  if (!hash) return;
  const m = hash.match(/^(sha256|sha384|sha512)[=-]([a-z\d+/=_-]+)$/i);
  if (!m) throw new Error('Unsupported asset integrity fragment: ' + hash);
  const actual = createHash(m[1].toLowerCase()).update(bytes);
  const hex = /^[a-f\d]+$/i.test(m[2]) && m[2].length === { sha256: 64, sha384: 96, sha512: 128 }[m[1].toLowerCase()];
  const expected = m[2].replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  if ((hex ? actual.digest('hex') : actual.digest('base64').replace(/=+$/, '')) !== (hex ? expected.toLowerCase() : expected)) throw new Error('Asset integrity mismatch');
}
