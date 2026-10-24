import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { catalog, type VaultCatalog } from '../catalog.js';
import * as vault from '../vault.js';
import { scheduleAutoCommitOnSave } from '../git.js';
import { queueFileUpdate } from '../fileupdates.js';
import { folderRuleTags, planFolderTags, inTagScope, planTagSource, transformTag, validateTagOperation, readTagSourceNames } from '@webobsidian/markdown-core';
import { matchesTag, normalizeStoredTags, tagKey, tagName, tagPageAliases, validTag } from '@webobsidian/search-core';
import type { TagApplyResult, TagCollision, TagFilePreview, TagOperation, TagPreferences, TagPreview, TagPreviewRequest, TagSummary } from '@webobsidian/markdown-core';
export type { TagPreferences } from '@webobsidian/markdown-core';

function fail(message: string, status = 400): never { throw Object.assign(new Error(message), { status }); }
interface PreviewRecord {
  public: TagPreview;
  root: string;
  files: Map<string, { revision?: string; version?: number; local: boolean; applied: boolean; generated: string[] }>;
  cancelled: boolean;
  applying: boolean;
  generated: Set<string>;
  folderConfiguration?: string;
}
let readPreferences: () => Promise<TagPreferences> = async () => ({ batchEnabled: true, wranglerEnabled: true });
/** Coordinator connects this to the existing per-vault settings object. */
export function configureTagPreferences(reader: typeof readPreferences): void { readPreferences = reader; }

function allTagNames(current: VaultCatalog): string[] {
  const names = new Set<string>();
  for (const note of current.notes.values()) {
    for (const tag of note.tags) if (validTag(tag)) names.add(tagName(tag));
    for (const alias of note.aliases) for (const tag of tagPageAliases(alias)) names.add(tag);
  }
  return [...names];
}
export function tagCollisions(operation: TagOperation, tags: readonly string[]): TagCollision[] {
  if (operation.kind !== 'rename' || tagKey(operation.from) === tagKey(operation.to)) return [];
  const existing = new Set(tags.map(tagKey));
  const collisions = new Map<string, TagCollision>();
  for (const tag of tags) {
    if (!matchesTag(tag, operation.from, operation.descendants !== false)) continue;
    const to = transformTag(tag, operation);
    if (existing.has(tagKey(to))) collisions.set(tagKey(tag) + '\0' + tagKey(to), { from: tag, to });
  }
  return [...collisions.values()].sort((a, b) => tagKey(a.from).localeCompare(tagKey(b.from)));
}

/** Read only saved catalog metadata. No watcher, disk scan or persistent tag cache. */
export function summarizeTags(current: VaultCatalog = catalog): TagSummary[] {
  const entries = new Map<string, { tag: string; direct: Set<string>; descendants: Set<string>; pages: Set<string> }>();
  const entry = (tag: string) => {
    const key = tagKey(tag);
    let item = entries.get(key);
    if (!item) { item = { tag: tagName(tag), direct: new Set(), descendants: new Set(), pages: new Set() }; entries.set(key, item); }
    return item;
  };
  for (const note of current.notes.values()) {
    for (const tag of normalizeStoredTags(note.tags)) {
      entry(tag).direct.add(note.path);
      const segments = tag.split('/');
      for (let i = 1; i <= segments.length; i++) entry(segments.slice(0, i).join('/')).descendants.add(note.path);
    }
    for (const alias of note.aliases) for (const tag of tagPageAliases(alias)) entry(tag).pages.add(note.path);
  }
  return [...entries.values()].map((item) => ({ tag: item.tag, count: item.descendants.size,
    directCount: item.direct.size, pages: [...item.pages].sort() })).sort((a, b) => a.tag.localeCompare(b.tag));
}

/** Short-lived transaction metadata only; never retains full document bodies. */
export class NativeTagService {
  private previews = new Map<string, PreviewRecord>();
  async summary() { return { tags: summarizeTags(), preferences: await readPreferences() }; }

  private prune() {
    const now = Date.now();
    for (const [id, item] of this.previews) if (item.public.expiresAt < now && !item.applying) this.previews.delete(id);
    while (this.previews.size >= 24) {
      const victim = [...this.previews].find(([, item]) => !item.applying);
      if (!victim) fail('Too many tag operations in progress', 429);
      this.previews.delete(victim[0]);
    }
  }
  private async allowed(operation: TagOperation) {
    const preferences = await readPreferences();
    if (operation.kind === 'folder-rules') {
      if (!preferences.folderTags?.rules.length) fail('请先在标签设置中配置文件夹规则', 403);
      return preferences;
    }
    if ((operation.kind === 'rename' ? !preferences.wranglerEnabled && !preferences.batchEnabled : !preferences.batchEnabled))
      fail('This native tag operation is disabled in settings', 403);
    return preferences;
  }
  async preview(input: TagPreviewRequest): Promise<TagPreview> {
    const operation = validateTagOperation(input.operation);
    const preferences = await this.allowed(operation);
    const current = catalog, root = await vault.getVaultRoot();
    const overlays = new Map((input.overlays ?? []).map((o) => [o.path, o]));
    const candidates = new Set<string>();
    const selectedFiles = input.scope.kind === 'files' ? new Set(input.scope.paths) : null;
    const inScope = (path: string) => selectedFiles ? /\.(?:md|markdown)$/i.test(path) && selectedFiles.has(path) : inTagScope(path, input.scope);
    const notes = selectedFiles ? [...selectedFiles].flatMap((path) => { const note = current.notes.get(path); return note ? [note] : []; }) : current.notes.values();
    for (const note of notes) {
      if (!inScope(note.path)) continue;
      if (operation.kind === 'folder-rules') {
        if (folderRuleTags(note.path, preferences.folderTags).length) candidates.add(note.path);
        continue;
      }
      if (operation.kind === 'add' || [...note.tags, ...(operation.kind === 'rename' ? note.aliases.flatMap(tagPageAliases) : [])]
        .some((tag) => operation.kind === 'rename' ? matchesTag(tag, operation.from, operation.descendants !== false) :
          operation.tags.some((wanted) => matchesTag(tag, wanted, operation.descendants !== false)))) candidates.add(note.path);
    }
    // Unsaved tags may have no saved catalog entry; overlays always join the
    // explicit scope and are planned with their current session source.
    for (const path of overlays.keys()) if (inScope(path)) candidates.add(path);
    const files: TagFilePreview[] = [];
    const extraTags: string[] = [];
    const generatedByFile = new Map<string, string[]>();
    const { extractMetadata, SourceDocument } = await import('@webobsidian/markdown-core');
    for (const overlay of overlays.values()) {
      extraTags.push(...extractMetadata(new SourceDocument(overlay.raw).text).tags, ...readTagSourceNames(overlay.raw));
    }
    for (const file of candidates) {
      const overlay = overlays.get(file);
      try {
        // Resolve even client-owned sessions through the existing Vault boundary.
        await vault.resolveInVault(file);
        const snapshot = overlay ?? await vault.readFileSnapshot(file);
        const raw = 'raw' in snapshot ? snapshot.raw : snapshot.content;
        const plan = operation.kind === 'folder-rules' ? planFolderTags(raw, file, preferences.folderTags) : planTagSource(raw, operation);
        if (plan.changes.length && operation.kind === 'rename') generatedByFile.set(file,
          [...extractMetadata(new SourceDocument(plan.raw).text).tags, ...readTagSourceNames(plan.raw)].map(tagKey));
        files.push({ path: file, status: plan.changes.length ? 'ready' : 'unchanged',
          revision: snapshot.revision, version: overlay?.version, local: Boolean(overlay),
          changes: plan.changes, expected: plan.expected });
      } catch (error) {
        files.push({ path: file, status: 'skipped', reason: String(error), local: Boolean(overlay), changes: [], expected: [] });
      }
    }
    this.prune();
    const preview: TagPreview = { id: randomUUID(), expiresAt: Date.now() + 15 * 60_000,
      operation, files, collisions: operation.kind === 'rename' ? tagCollisions(operation, [...allTagNames(current), ...extraTags]) : [] };
    // Keep only revision/ownership markers. Patches are returned to the client,
    // then recomputed from the revision-checked current snapshot on remote apply.
    this.previews.set(preview.id, { public: { ...preview, files: [] }, root, cancelled: false, applying: false, generated: new Set(),
      folderConfiguration: operation.kind === 'folder-rules' ? JSON.stringify(preferences.folderTags) : undefined,
      files: new Map(files.filter((file) => file.status === 'ready').map((file) => [file.path,
        { revision: file.revision, version: file.version, local: file.local, applied: false, generated: generatedByFile.get(file.path) ?? [] }])) });
    return preview;
  }

  private async transaction(id: string): Promise<PreviewRecord> {
    const item = this.previews.get(id);
    if (!item || item.public.expiresAt < Date.now()) fail('Tag preview expired; preview again', 409);
    if (item.cancelled) fail('Tag operation cancelled', 409);
    if (item.root !== await vault.getVaultRoot()) fail('Vault changed after tag preview', 409);
    const preferences = await this.allowed(item.public.operation);
    if (item.folderConfiguration !== undefined && item.folderConfiguration !== JSON.stringify(preferences.folderTags))
      fail('文件夹规则在预览后已改变，请重新预览', 409);
    return item;
  }
  async apply(id: string, path: string, confirmMerge: boolean, local = false): Promise<TagApplyResult> {
    const item = await this.transaction(id);
    const file = item.files.get(path);
    if (!file || file.applied) fail('File is absent from this preview or was already applied', 409);
    if (item.applying) fail('Apply one tag file at a time', 409);
    if (item.public.collisions.length && !confirmMerge) fail('Explicit merge confirmation is required', 409);
    // A newly introduced destination collision was not shown in this preview.
    const currentCollisions = item.public.operation.kind === 'rename' ? tagCollisions(item.public.operation, allTagNames(catalog)) : [];
    const confirmed = new Set(item.public.collisions.map((c) => tagKey(c.from) + '\0' + tagKey(c.to)));
    if (currentCollisions.some((c) => !confirmed.has(tagKey(c.from) + '\0' + tagKey(c.to)) && !item.generated.has(tagKey(c.to))))
      fail('Merge targets changed after preview; preview again', 409);
    item.applying = true;
    try {
      if (file.local || local) {
        const disk = await vault.readFileSnapshot(path);
        if (disk.revision !== file.revision) fail('File changed on disk after preview; local source preserved', 409);
        if (item.cancelled) fail('Tag operation cancelled', 409);
        file.applied = true;
        for (const tag of file.generated) item.generated.add(tag);
        return { path, status: 'local' };
      }
      const snapshot = await vault.readFileSnapshot(path);
      if (snapshot.revision !== file.revision) fail('File changed after preview; preview again', 409);
      const plan = item.public.operation.kind === 'folder-rules'
        ? planFolderTags(snapshot.content, path, (await readPreferences()).folderTags)
        : planTagSource(snapshot.content, item.public.operation);
      await this.transaction(id);
      if (item.cancelled) fail('Tag operation cancelled', 409);
      const result = await vault.writeFileText(path, plan.raw, snapshot.revision);
      file.applied = true;
      for (const tag of file.generated) item.generated.add(tag);
      return { path, status: 'written', revision: result.revision };
    } finally { item.applying = false; }
  }
  cancel(id: string) {
    const item = this.previews.get(id);
    if (item) { item.cancelled = true; if (!item.applying) this.previews.delete(id); }
  }

  async page(tag: string): Promise<{ pages: string[]; suggestedPath: string; content: string }> {
    if (!validTag(tag)) fail('Invalid tag');
    const preferences = await readPreferences();
    if (!preferences.wranglerEnabled) fail('Tag Wrangler features are disabled', 403);
    const pages = [...catalog.notes.values()].filter((note) => note.aliases.some((alias) => tagPageAliases(alias).some((value) => tagKey(value) === tagKey(tag))))
      .map((note) => note.path).sort();
    const basename = tagName(tag).replaceAll('/', ' ');
    return { pages, suggestedPath: basename + '.md', content: `---\naliases: [${JSON.stringify('#' + tagName(tag))}]\n---\n` };
  }
  async createPage(tag: string, relative: string): Promise<{ path: string }> {
    const page = await this.page(tag);
    if (page.pages.length) fail('This tag already has a page; open an existing page', 409);
    if (!/\.(md|markdown)$/i.test(relative)) fail('Tag Pages must be Markdown files');
    // Existing api.write/createNote overwrites an existing file. Exclusive create
    // is required here; reuse Vault path authorization and file-update queue.
    const absolute = await vault.resolveInVault(relative);
    const current = catalog.resolve(relative, '', 'allFiles');
    const exactKey = (value: string) => value.normalize('NFC').toLowerCase();
    const exact = current.status === 'resolved' ? exactKey(current.path) === exactKey(relative) :
      current.candidates.some((candidate) => exactKey(candidate) === exactKey(relative));
    if (exact || await vault.exists(relative)) fail('Tag Page path already exists', 409);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    try { await fs.writeFile(absolute, page.content, { encoding: 'utf8', flag: 'wx' }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') fail('Tag Page path already exists', 409); throw error; }
    await queueFileUpdate(relative, 'add');
    scheduleAutoCommitOnSave();
    return { path: relative };
  }
}
export const nativeTags = new NativeTagService();
