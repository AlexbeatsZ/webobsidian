import type { IncomingMessage } from 'node:http';
import type { Request, Response, NextFunction } from 'express';

function loopback(host: string): boolean {
  return host === 'localhost' || host === '[::1]' || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host);
}

/** One access rule for this personal, local-only application and its WebSocket. */
export function isLocalRequest(req: IncomingMessage): boolean {
  const peer = req.socket.remoteAddress?.replace(/^::ffff:/, '') ?? '';
  if (!loopback(peer)) return false;
  try {
    if (!loopback(new URL(`http://${req.headers.host ?? ''}`).hostname)) return false;
    const origin = req.headers.origin;
    if (origin && (!['http:', 'https:'].includes(new URL(origin).protocol) || !loopback(new URL(origin).hostname))) return false;
    return true;
  } catch { return false; }
}

export function requireLocal(req: Request, res: Response, next: NextFunction): void {
  if (isLocalRequest(req)) next();
  else res.status(403).json({ error: '仅允许本机访问' });
}
