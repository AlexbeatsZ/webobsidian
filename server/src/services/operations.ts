import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { SourceDocument, reviewHunks, materializeReview, rebaseReview, mergeReview,
  operationNames, type OperationName, type TextProposalInput, type ReviewProposal, type ReviewHunk } from '@webobsidian/markdown-core';
import { config } from '../config.js';
import { operationContract } from '../operations/contract.js';
import * as vault from './vault.js';
import { catalog } from './catalog.js';
import { qmd } from './search.js';
import { broadcast } from './realtime.js';
import { applyInWorkspace, captureWorkspaces, type WorkspaceCapture } from './operationWorkspace.js';

const MAX_TEXT = 1024 * 1024;
const hash = (text: string) => createHash('sha256').update(text).digest('base64url');
function fail(message: string, status = 409): never { throw Object.assign(new Error(message), { status }); }
function visible(input: string, root = false): string {
  if (root && (!input || input === '.')) return '';
  const normalized = input.replace(/\\/g, '/');
  if (normalized.startsWith('/') || normalized.split('/').some(p => !p || p.startsWith('.') || /[\x00-\x1f:*?"<>|]/.test(p)))
    fail('只允许可见笔记中的 Vault 相对路径', 400);
  return normalized;
}
const under = (file: string, prefix: string) => !prefix || file === prefix || file.startsWith(prefix + '/');
type Snapshot = { raw: string; revision: string; disk: { content: string; revision: string }; owner?: WorkspaceCapture };

async function snapshot(file: string, captures?: WorkspaceCapture[]): Promise<Snapshot> {
  visible(file);
  const disk = await vault.readFileSnapshot(file);
  if (disk.content.length > MAX_TEXT) fail('单文件候选上限为 1 Mi UTF-16 字符', 413);
  const workspaces = captures ?? await captureWorkspaces(file);
  if (workspaces.some(c => c.stale)) fail('有工作区已经切换 Vault，请重新加载后继续');
  const opened = workspaces.filter(c => c.document?.path === file);
  if (opened.some(c => c.document!.saving || c.document!.conflict)) fail('目标文档正在保存或已有外部冲突');
  const dirty = opened.filter(c => c.document!.dirty);
  const raw = dirty[0]?.document!.raw ?? disk.content;
  if (dirty.some(c => c.document!.raw !== raw) || opened.some(c => c.document!.dirty && c.document!.revision !== disk.revision))
    fail('同一文件有不同草稿或磁盘版本已变化，请先解决冲突');
  // Clean cached sessions can lag a disk notification. Do not use their stale text.
  const owner = opened.find(c => c.document!.raw === raw && c.document!.revision === disk.revision);
  return { raw, revision: hash(raw), disk, owner };
}

/** Node persistence belongs here; pure review/range logic remains in markdown-core. */
class NativeReview {
  private root = '';
  private records = new Map<string, ReviewProposal & { fingerprint: string }>();
  private serial: Promise<unknown> = Promise.resolve();
  private directory = '';
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const job = this.serial.then(work); this.serial = job.catch(() => {}); return job;
  }
  private async load() {
    const root = await vault.getVaultRoot();
    if (this.root === root) return;
    this.directory = path.join(config.dataDir, 'review', hash(root));
    const next = new Map<string, ReviewProposal & { fingerprint: string }>();
    const files = await fs.readdir(this.directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return []; throw error;
    });
    for (const name of files.filter(n => /^[a-f\d-]{36}\.json$/.test(n))) {
      const p = JSON.parse(await fs.readFile(path.join(this.directory, name), 'utf8')) as ReviewProposal & { fingerprint: string };
      if (p.root === root && p.id + '.json' === name) next.set(p.id, p);
    }
    this.records = next; this.root = root;
  }
  private async save(p: ReviewProposal & { fingerprint: string }) {
    if (await vault.getVaultRoot() !== p.root) fail('Vault 已切换，保留候选但停止本次操作');
    await fs.mkdir(this.directory, { recursive: true });
    const file = path.join(this.directory, p.id + '.json'), temp = file + '.tmp-' + randomUUID();
    try { await fs.writeFile(temp, JSON.stringify(p), { mode: 0o600 }); await fs.rename(temp, file); }
    finally { await fs.unlink(temp).catch(() => {}); }
    broadcast({ type: 'review-changed', id: p.id });
  }
  private get(id: string) {
    return this.records.get(id) ?? fail('找不到候选修改', 404);
  }
  private async settle(p: ReviewProposal & { fingerprint: string }) {
    if (!p.uncertain) return;
    const j = p.uncertain, current = await vault.readFileSnapshot(p.path);
    if (current.content === j.after) {
      if (j.kind === 'accept') { p.applied.push({ before: j.before, after: j.after }); p.hunks = j.hunks; }
      else p.restored = true;
    } else if (current.content !== j.diskBefore) {
      const error = '上次写入结果无法确认；保留了写前原文和候选，请先检查文件';
      if (p.error !== error) { p.error = error; await this.save(p); }
      return;
    } else {
      const drafts = await captureWorkspaces(p.path);
      if (drafts.some(c => c.document?.path === p.path && c.document.dirty && c.document.raw === j.after)) {
        const error = '接受后的草稿尚未确认落盘；请先保存或撤销该草稿，再核对候选状态';
        if (p.error !== error) { p.error = error; await this.save(p); }
        return;
      }
    }
    delete p.uncertain; delete p.error; await this.save(p);
  }
  list() { return this.enqueue(async () => { await this.load();
    return [...this.records.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(p => ({
      id: p.id, path: p.path, title: p.title, pending: p.hunks.some(h => h.decision === 'pending') && !p.restored, createdAt: p.createdAt,
    }));
  }); }
  read(id: string) { return this.enqueue(async () => { await this.load(); const p = this.get(id); await this.settle(p); return structuredClone(p); }); }
  propose(input: TextProposalInput) { return this.enqueue(async () => {
    await this.load();
    const fingerprint = hash(JSON.stringify(input));
    const prior = [...this.records.values()].find(p => p.request_id === input.request_id);
    if (prior) {
      if (prior.fingerprint !== fingerprint) fail('request_id 已用于不同内容');
      return this.statusOf(prior);
    }
    if (this.records.size >= 200) fail('本 Vault 已保存 200 个审阅记录；请先归档审阅数据再提交新候选', 413);
    const op = input.operations[0], file = visible(op.path);
    if (!/\.(md|markdown)$/i.test(file)) fail('当前原生审阅仅支持已有 Markdown 文件', 400);
    const root = this.root, before = await snapshot(file);
    if (before.revision !== op.base_revision) fail('文件版本已变化，请重新读取');
    if (op.edits.reduce((n, e) => n + e.replacement.length, 0) > MAX_TEXT) fail('替换文本总长度超过上限', 413);
    const source = new SourceDocument(before.raw), starts = [0];
    for (let i = 0; i < source.text.length; i++) if (source.text[i] === '\n') starts.push(i + 1);
    const offset = (p: { line: number; ch: number }) => {
      const start = starts[p.line - 1], end = (starts[p.line] ?? (source.text.length + 1)) - 1;
      if (start === undefined || p.ch > end - start) fail('修改位置超出文档范围', 400);
      return start + p.ch;
    };
    const changes = op.edits.map(e => {
      const from = offset(e.from), to = offset(e.to);
      if (source.text.slice(from, to) !== e.expected_text) fail('预期原文不匹配，请重新读取');
      return { from, to, insert: e.replacement };
    });
    source.apply(changes);
    const candidate = await vault.prepareNoteSave(file, source.raw);
    if (candidate.length > MAX_TEXT) fail('候选正文超过上限', 413);
    if (await vault.getVaultRoot() !== root) fail('Vault 已切换');
    const p = { id: randomUUID(), request_id: input.request_id, fingerprint, title: input.title ?? '候选修改', root,
      path: file, createdAt: new Date().toISOString(), baseline: before.raw, hunks: reviewHunks(before.raw, candidate), applied: [] };
    await this.save(p); this.records.set(p.id, p); return this.statusOf(p);
  }); }
  private statusOf(p: ReviewProposal) {
    return { vault: hash(p.root), proposal_id: p.id, path: p.path, title: p.title,
      status: p.uncertain ? 'recovery_required' : p.restored ? 'restored' : p.error ? 'conflict'
        : p.hunks.some(h => h.decision === 'pending') ? p.applied.length ? 'partially_applied' : 'awaiting_user_review' : 'completed',
      revision: hash(materializeReview(p.baseline, p.hunks)), error: p.error,
      hunks: p.hunks.map(h => ({ hunk_id: h.id, status: h.decision })), applied_steps: p.applied.length };
  }
  async status(id: string) { return this.statusOf(await this.read(id)); }
  decide(id: string, clientId: string, decision: 'accepted' | 'rejected', hunkId?: string, recover = false) {
    return this.enqueue(async () => {
      await this.load(); const p = this.get(id); await this.settle(p);
      if (p.uncertain) fail(p.error ?? '请先核对中断写入');
      if (p.restored) fail('该候选已经恢复');
      if (decision === 'rejected' && !recover) {
        for (const h of p.hunks) if (h.decision === 'pending' && (!hunkId || h.id === hunkId)) h.decision = 'rejected';
        delete p.error; await this.save(p); return this.statusOf(p);
      }
      const captures = await captureWorkspaces(p.path), current = await snapshot(p.path, captures);
      const owner = captures.find(c => c.clientId === clientId && c.document?.path === p.path);
      if (!owner?.document || owner.stale || owner.document.raw !== current.raw || owner.document.revision !== current.disk.revision)
        fail('请在审阅窗口打开当前版本的目标笔记');
      if (captures.some(c => c.clientId !== clientId && c.document?.path === p.path && c.document.dirty))
        fail('另一个工作区持有未保存草稿，请先保存或关闭该草稿');
      let next: string, nextHunks: ReviewHunk[];
      if (recover) {
        next = current.raw;
        for (const step of [...p.applied].reverse()) {
          const merged = mergeReview(step.after, next, step.before);
          if (merged === null) fail('已接受的行在之后被修改，无法自动恢复');
          next = merged;
        }
        if (!p.applied.length) fail('没有已接受的改动');
        nextHunks = p.hunks;
      } else {
        const rebased = rebaseReview(p.baseline, p.hunks, current.raw);
        if (!rebased) { p.error = '待审阅的行已经改变，请撤销冲突编辑或拒绝剩余候选'; await this.save(p); fail(p.error); }
        nextHunks = rebased.map(h => h.decision === 'pending' && (!hunkId || h.id === hunkId) ? { ...h, decision } : h);
        if (!rebased.some(h => h.decision === 'pending' && (!hunkId || h.id === hunkId))) fail('候选块不存在或已处理');
        next = materializeReview(current.raw, nextHunks);
        p.baseline = current.raw; p.hunks = rebased;
      }
      // No hidden auto-tag or formatting changes after the local decision.
      if (await vault.prepareNoteSave(p.path, next) !== next) fail('保存规则会改变审阅结果，请重新提交候选');
      p.uncertain = { before: current.raw, diskBefore: current.disk.content, after: next, kind: recover ? 'recover' : 'accept', hunks: nextHunks };
      delete p.error; await this.save(p);
      try { await applyInWorkspace(clientId, owner.document, next); }
      catch (error) {
        await this.settle(p);
        if (p.uncertain) p.error = (error as Error).message;
        await this.save(p); throw error;
      }
      await this.settle(p);
      if (p.uncertain) fail(p.error ?? '写入尚未确认');
      return this.statusOf(p);
    });
  }
}
export const nativeReview = new NativeReview();

export async function callOperation(name: OperationName, raw: unknown): Promise<object> {
  if (!(operationNames as readonly string[]).includes(name)) fail('不支持该操作', 400);
  const args = operationContract[name].schema.parse(raw ?? {}) as any;
  const root = await vault.getVaultRoot(), vaultId = hash(root);
  switch (name) {
    case 'obsidian_list_files': {
      const prefix = visible(args.path, true);
      const files = [...catalog.entries.values()].filter(f => f.kind === 'file' && !f.path.split('/').some(p => p.startsWith('.')) && under(f.path, prefix)
        && (args.type === 'all' || (args.type === 'markdown' ? /\.(md|markdown)$/i.test(f.path) : args.type === 'text' ? vault.isTextFile(f.path) : !vault.isTextFile(f.path))))
        .sort((a, b) => a.path.localeCompare(b.path));
      return { vault: vaultId, files: files.slice(args.offset, args.offset + args.limit), total: files.length,
        next_offset: args.offset + args.limit < files.length ? args.offset + args.limit : null };
    }
    case 'obsidian_search': {
      const prefix = visible(args.path, true);
      return { vault: vaultId, scope: 'saved-markdown-index', query: args.query,
        results: (await qmd.search(args.query, 0, args.mode)).filter(f => under(f.path, prefix)).slice(0, args.max_results) };
    }
    case 'obsidian_read_file': {
      const file = visible(args.path);
      if (!vault.isTextFile(file)) {
        const stat = await fs.stat(await vault.resolveInVault(file));
        if (!stat.isFile()) fail('目标不是文件', 400);
        return { vault: vaultId, path: file, supported_content: false, size: stat.size, mtime: stat.mtimeMs };
      }
      const current = await snapshot(file), lines = new SourceDocument(current.raw).text.split('\n');
      if (args.start_line > lines.length) fail('起始行超出范围', 400);
      const wanted = lines.slice(args.start_line - 1, args.start_line - 1 + args.line_count).join('\n'), content = wanted.slice(0, 32768);
      const partial = content.length !== wanted.length;
      return { vault: vaultId, path: file, content, revision: current.revision, start_line: args.start_line,
        total_lines: lines.length, partial_line: partial, truncated: partial || args.start_line - 1 + args.line_count < lines.length,
        next_line: partial ? args.start_line : args.start_line + Math.min(args.line_count, lines.length - args.start_line + 1) };
    }
    case 'obsidian_get_context': {
      const captures = await captureWorkspaces();
      if (!captures.length) fail('请打开本体笔记窗口');
      if (captures.some(c => c.stale)) fail('请重新加载已切换 Vault 的工作区');
      const active = [...captures].sort((a, b) => b.interactedAt - a.interactedAt)[0];
      if (!active.activePath || !active.document) return { vault: vaultId, path: null, selections: [], source: 'no_active_note' };
      const file = visible(active.activePath), current = await snapshot(file, captures);
      if (active.document.raw !== current.raw) fail('当前笔记快照与其他窗口草稿不一致');
      const lines = new SourceDocument(current.raw).text.split('\n'), line = active.cursor?.line ?? 1;
      return { vault: vaultId, context_id: `${active.clientId}:${active.document.version}`, captured_at: new Date().toISOString(),
        path: file, revision: current.revision, mode: active.mode, selections: active.selections, cursor: active.cursor,
        nearby_start_line: Math.max(1, line - args.nearby_lines),
        nearby_text: lines.slice(Math.max(0, line - args.nearby_lines - 1), line + args.nearby_lines).join('\n').slice(0, 32768),
        open_notes: active.open, recent_notes: active.recent, linked_notes: catalog.notes.get(file)?.links.slice(0, 30) ?? [] };
    }
    case 'obsidian_propose_changes': return nativeReview.propose(args);
    case 'obsidian_get_change_status': return nativeReview.status(args.proposal_id);
  }
}
