import type { ScriptRecord } from '../../../web/src/lib/userscripts/types';
import { randomUUID } from 'node:crypto';
import { compareVersions, identity, needsApproval, parseMetadata } from './metadata';
import { scriptFetch } from './network';
import { prepareBundle, UserscriptStore } from './store';

/** Single updater: per-id coalescing, CAS installs, bounded schedule and disposal. */
export class UserscriptUpdater {
  private running = new Map<string, Promise<void>>();
  private controller = new AbortController();
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private store: UserscriptStore, private onError: (error: unknown) => void) {}
  start() { this.timer = setTimeout(() => void this.tick(), 60000); this.timer.unref(); }
  private async tick() {
    try {
      const d = this.store.snapshot();
      if (d.autoUpdate) for (const s of d.scripts) {
        if (this.controller.signal.aborted) break;
        if (s.autoUpdate && Date.now() - (s.update.checkedAt ?? 0) >= d.intervalHours * 3600000) await this.check(s.id, true);
      }
    } catch (error) { this.onError(error); }
    finally {
      if (!this.controller.signal.aborted) { this.timer = setTimeout(() => void this.tick(), 60000); this.timer.unref(); }
    }
  }
  check(id: string, install: boolean): Promise<void> {
    const existing = this.running.get(id);
    // An explicit install after an overlapping check re-evaluates its resulting state.
    if (existing) return install ? existing.then(() => this.check(id, true)) : existing;
    const task = this.perform(this.store.get(id), install).finally(() => this.running.delete(id));
    this.running.set(id, task); return task;
  }
  private async perform(old: ScriptRecord, install: boolean) {
    if (old.update.state === 'import-review') return; // Never auto-install/replace a manual import awaiting review.
    const raw = old.metadata.raw;
    const downloadUrl = raw.downloadurl?.[0] || old.sourceUrl;
    const updateUrl = raw.updateurl?.[0] || downloadUrl;
    if (downloadUrl === 'none' || updateUrl === 'none' || !updateUrl || !downloadUrl || !old.metadata.version) {
      await this.state(old, { state: 'unavailable', checkedAt: Date.now(), error: 'Updates require @version and an HTTP(S) source/update/download URL; none disables updates' }); return;
    }
    try {
      let pending = install ? old.update.pending : undefined;
      let validators = { ...old.update.validators };
      if (!pending) {
        const cached = validators[updateUrl], headers: Record<string, string> = {};
        if (cached?.etag) headers['If-None-Match'] = cached.etag;
        if (cached?.modified) headers['If-Modified-Since'] = cached.modified;
        const meta = await scriptFetch(updateUrl, { headers, signal: this.controller.signal });
        if (meta.status === 304) { await this.state(old, { ...old.update, state: old.update.pending ? old.update.state : 'current', checkedAt: Date.now(), error: undefined }); return; }
        if (meta.status !== 200) throw new Error('Update metadata HTTP ' + meta.status);
        const metadata = parseMetadata(meta.bytes.toString('utf8'));
        if (identity(metadata) !== identity(old.metadata)) throw new Error('Update script identity does not match');
        if (!metadata.version) throw new Error('Update has no @version');
        validators[updateUrl] = { etag: meta.headers.etag, modified: meta.headers['last-modified'] };
        if (compareVersions(metadata.version, old.metadata.version) <= 0) {
          await this.state(old, { state: 'current', checkedAt: Date.now(), validators }); return;
        }
        const downloaded = updateUrl === downloadUrl ? meta : await scriptFetch(downloadUrl, { signal: this.controller.signal });
        if (downloaded.status !== 200) throw new Error('Download HTTP ' + downloaded.status);
        pending = await prepareBundle(downloaded.bytes.toString('utf8'), this.controller.signal);
        if (identity(pending.metadata) !== identity(old.metadata) || compareVersions(pending.metadata.version, metadata.version) < 0) throw new Error('Downloaded source identity/version does not match metadata');
      }
      const approvalNeeded = needsApproval(old.approved, pending.metadata);
      await this.store.mutate(d => {
        const current = d.scripts.find(s => s.id === old.id);
        if (!current || current.revision !== old.revision) throw new Error('Script changed during update; downloaded result discarded');
        if (install && !approvalNeeded) {
          Object.assign(current, pending, { revision: current.revision + 1, updatedAt: Date.now(),
            update: { state: 'updated', checkedAt: Date.now(), validators } });
        } else current.update = { state: approvalNeeded ? 'approval-required' : 'available', checkedAt: Date.now(), validators,
          availableVersion: pending!.metadata.version, pending, candidateId: randomUUID() };
      });
    } catch (e) {
      await this.state(old, { ...old.update, state: 'error', checkedAt: Date.now(), error: String(e) });
    }
  }
  private state(old: ScriptRecord, update: ScriptRecord['update']) {
    return this.store.mutate(d => { const s = d.scripts.find(s => s.id === old.id); if (s?.revision === old.revision) s.update = update; });
  }
  async stop() { this.controller.abort(); clearTimeout(this.timer); await Promise.allSettled(this.running.values()); }
}
