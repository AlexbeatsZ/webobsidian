import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { config } from '../config.js';
import { getVaultRoot } from './vaultFile.js';
import { broadcast } from './realtime.js';
import type { McpContextItem } from '../contracts.js';

const point = z.object({ line: z.number().int().min(1), ch: z.number().int().min(0) });
export const mcpSelectionSchema = z.object({ kind: z.enum(['source', 'rendered']), text: z.string().min(1).max(16384),
  from: point.optional(), to: point.optional() });
const itemSchema = z.object({ id: z.string().uuid(), kind: z.enum(['page', 'selection']), path: z.string().min(1).max(1024),
  pinned: z.boolean(), createdAt: z.string(), revision: z.string().optional(), selections: z.array(mcpSelectionSchema).min(1).max(20).optional() });
const vaultId = (root: string) => createHash('sha256').update(root).digest('base64url');
const failure = (message: string, status = 409) => Object.assign(new Error(message), { status });

export class McpContextQueue {
  private serial: Promise<unknown> = Promise.resolve();
  private deliveries: Promise<unknown> = Promise.resolve();
  constructor(private directory: string, private root: () => Promise<string>, private changed: () => void) {}

  private run<T>(work: (root: string, items: McpContextItem[], save: (next: McpContextItem[]) => Promise<void>) => Promise<T>): Promise<T> {
    const job = this.serial.then(async () => {
      const root = await this.root(), file = path.join(this.directory, vaultId(root) + '.json');
      const stored = await fs.readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return '[]'; throw error;
      });
      const items = z.array(itemSchema).max(50).parse(JSON.parse(stored));
      const save = async (next: McpContextItem[]) => {
        if (next.length > 50 || JSON.stringify(next).length > 512 * 1024) throw failure('MCP 上下文已满，请先移除部分项目', 413);
        await fs.mkdir(this.directory, { recursive: true });
        const temporary = file + '.tmp-' + randomUUID();
        try {
          await fs.writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
          if (await this.root() !== root) throw failure('Vault 已切换，未更新上下文');
          await fs.rename(temporary, file);
        } finally { await fs.unlink(temporary).catch(() => {}); }
        this.changed();
      };
      const result = await work(root, items, save);
      if (await this.root() !== root) throw failure('Vault 已切换，请重新读取上下文');
      return result;
    });
    this.serial = job.catch(() => {});
    return job;
  }

  list() { return this.run(async (root, items) => ({ vault: vaultId(root), items })); }
  deliver(work: () => Promise<void>) {
    const delivery = this.deliveries.then(work);
    this.deliveries = delivery.catch(() => {});
    return delivery;
  }
  add(input: Pick<McpContextItem, 'kind' | 'path' | 'revision' | 'selections'>, expectedVault: string) {
    return this.run(async (root, items, save) => {
      if (vaultId(root) !== expectedVault) throw failure('Vault 已切换，未添加上下文');
      const entry = itemSchema.parse({ ...input, id: randomUUID(), pinned: false, createdAt: new Date().toISOString() });
      const next = [...items, entry]; await save(next); return { vault: vaultId(root), items: next };
    });
  }
  change(id: string, pinned?: boolean) {
    return this.run(async (root, items, save) => {
      if (!items.some(item => item.id === id)) throw failure('上下文已移除，请刷新面板', 404);
      const next = pinned === undefined ? items.filter(item => item.id !== id) : items.map(item => item.id === id ? { ...item, pinned } : item);
      await save(next); return { vault: vaultId(root), items: next };
    });
  }
  consume(expectedVault: string, delivered: Pick<McpContextItem, 'id' | 'pinned'>[]) {
    return this.run(async (root, items, save) => {
      if (vaultId(root) !== expectedVault) return;
      const ids = new Set(delivered.filter(item => !item.pinned).map(item => item.id));
      const next = items.filter(item => item.pinned || !ids.has(item.id));
      if (next.length !== items.length) await save(next);
    });
  }
}

export const mcpContext = new McpContextQueue(path.join(config.dataDir, 'mcp-context'), getVaultRoot,
  () => broadcast({ type: 'mcp-context-changed' }));
