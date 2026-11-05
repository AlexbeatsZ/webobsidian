import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { asyncHandler } from '../middleware/error.js';
import * as vault from '../services/vault.js';
import { resolveInVault, listTree, isTextFile, readFileSnapshot, resolveDirCaseInsensitive, exists } from '../services/vaultFile.js';
import { getSettings } from '../services/settings.js';
import { resolveFile } from '../services/fileindex.js';
import { mimeFor } from '../services/mime.js';
import { sendFileWithRange } from '../services/httpfile.js';
import { vaultConfigurationIdentity } from '../services/vaultConfiguration.js';
import { defaultFileFolder, VaultFolderSchema } from '../contracts/filePlacement.js';
import type { TreeNode } from '../contracts.js';
import { describeVirtualDocuments, defaultVirtualManifest, saveVirtualManifest, disableVirtualDocument } from '../services/virtualDocuments.js';

export const filesRouter = Router();

// Browsers send multipart filenames as UTF-8; multer's latin1 default garbles CJK names.
// multer 2 supports this option; @types/multer has not declared it yet.
const uploadOptions: multer.Options & { defParamCharset: 'utf8' } = {
  storage: multer.memoryStorage(), defParamCharset: 'utf8', limits: { fileSize: 512 * 1024 * 1024 },
};
const upload = multer(uploadOptions);

filesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json(await describeVirtualDocuments(await listTree()));
  }),
);

filesRouter.put('/virtual-document', asyncHandler(async (req, res) => {
  const { folder, manifest, revision } = req.body ?? {};
  if (typeof folder !== 'string' || revision !== undefined && typeof revision !== 'string')
    throw Object.assign(new Error('Invalid continuous document configuration'), { status: 400 });
  let next = manifest;
  if (next === undefined) {
    const root = await listTree(), stack = [root];
    let target: TreeNode | undefined;
    while (stack.length) { const node = stack.pop()!; if (node.path === folder) target = node; stack.push(...node.children ?? []); }
    if (!target || target.type !== 'folder') throw Object.assign(new Error('找不到资料文件夹'), { status: 404 });
    next = defaultVirtualManifest(target);
  }
  res.json({ ok: true, ...await saveVirtualManifest(folder, next, revision) });
}));
filesRouter.delete('/virtual-document', asyncHandler(async (req, res) => {
  const { folder, revision } = req.body ?? {};
  if (typeof folder !== 'string' || typeof revision !== 'string') throw Object.assign(new Error('Invalid configuration revision'), { status: 400 });
  res.json({ ok: true, trashed: await disableVirtualDocument(folder, revision) });
}));

filesRouter.get(
  '/content',
  asyncHandler(async (req, res) => {
    let rel = String(req.query.path ?? '');
    if (!rel) {
      res.status(400).json({ error: 'path required' });
      return;
    }
    // Obsidian-style resolution: if the exact path doesn't exist (e.g. an embed
    // `![[image.jpg]]` that lives in Attachments/), resolve it by basename.
    if (req.query.sourcePath || !(await exists(rel))) {
      const resolved = resolveFile(rel, String(req.query.sourcePath ?? ''));
      if (resolved) rel = resolved;
    }
    if (isTextFile(rel) && req.query.raw !== '1') {
      res.json({ path: rel, ...(await readFileSnapshot(rel)), encoding: 'utf8', vault: (await vaultConfigurationIdentity()).vault });
    } else {
      // Stream with Range support so embedded <video>/<audio> can seek.
      const abs = await resolveInVault(rel);
      await sendFileWithRange(req, res, abs, mimeFor(rel));
    }
  }),
);

filesRouter.put(
  '/content',
  asyncHandler(async (req, res) => {
    const { path: rel, content, baseRevision, createOnly } = req.body ?? {};
    if (typeof rel !== 'string' || typeof content !== 'string') {
      res.status(400).json({ error: 'path and content required' });
      return;
    }
    if (baseRevision !== undefined && typeof baseRevision !== 'string') {
      res.status(400).json({ error: 'baseRevision must be a string' });
      return;
    }
    if (createOnly !== undefined && (typeof createOnly !== 'boolean' || (createOnly && baseRevision !== undefined))) {
      res.status(400).json({ error: 'createOnly must be a boolean without baseRevision' }); return;
    }
    const snapshot = await vault.writeFileText(rel, content, baseRevision, { createOnly: createOnly === true });
    res.json({ ok: true, path: rel, ...snapshot });
  }),
);

filesRouter.post(
  '/folder',
  asyncHandler(async (req, res) => {
    const { path: rel } = req.body ?? {};
    if (typeof rel !== 'string') {
      res.status(400).json({ error: 'path required' });
      return;
    }
    await vault.createFolder(rel);
    res.json({ ok: true, path: rel });
  }),
);

filesRouter.post(
  '/upload',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const settings = await getSettings();
    const selected = req.body?.dir ?? defaultFileFolder(settings.vault, String(req.body?.sourcePath ?? ''), true);
    const folder = VaultFolderSchema.safeParse(selected);
    if (!folder.success) throw Object.assign(new Error('请输入有效的附件文件夹路径'), { status: 400 });
    const dir = folder.data;
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'file required' });
      return;
    }
    // Reuse an existing folder that differs only in case (e.g. an Obsidian vault's
    // "Attachments") instead of creating a duplicate "attachments". See vaultFile.ts.
    const resolvedDir = dir ? await resolveDirCaseInsensitive(dir) : '';
    const rel = await vault.createFileBuffer(resolvedDir, path.posix.basename(file.originalname.replace(/\\/g, '/')), file.buffer);
    res.json({ ok: true, path: rel, size: file.size });
  }),
);

filesRouter.patch(
  '/rename',
  asyncHandler(async (req, res) => {
    const { from, to, baseRevision } = req.body ?? {};
    if (typeof from !== 'string' || typeof to !== 'string') {
      res.status(400).json({ error: 'from and to required' });
      return;
    }
    if (baseRevision !== undefined && typeof baseRevision !== 'string') {
      res.status(400).json({ error: 'baseRevision must be a string' }); return;
    }
    await vault.rename(from, to, baseRevision);
    res.json({ ok: true, from, to });
  }),
);

filesRouter.post(
  '/copy',
  asyncHandler(async (req, res) => {
    const { from, to } = req.body ?? {};
    if (typeof from !== 'string' || typeof to !== 'string') {
      res.status(400).json({ error: 'from and to required' });
      return;
    }
    await vault.copy(from, to);
    res.json({ ok: true, from, to });
  }),
);

// --- Trash (FR-1) -----------------------------------------------------------
// Listed/mutated via dedicated /trash* routes; the plain DELETE / below either
// trashes or permanently removes depending on settings.vault.deleteMode.

filesRouter.get(
  '/trash',
  asyncHandler(async (_req, res) => {
    res.json({ items: await vault.listTrash() });
  }),
);

filesRouter.post(
  '/trash/restore',
  asyncHandler(async (req, res) => {
    const rel = String(req.body?.path ?? '');
    if (!rel) {
      res.status(400).json({ error: 'path required' });
      return;
    }
    const restored = await vault.restoreFromTrash(rel);
    res.json({ ok: true, restored });
  }),
);

// Permanently delete one trashed item.
filesRouter.delete(
  '/trash/item',
  asyncHandler(async (req, res) => {
    const rel = String(req.query.path ?? '');
    if (!rel) {
      res.status(400).json({ error: 'path required' });
      return;
    }
    await vault.deleteFromTrash(rel);
    res.json({ ok: true });
  }),
);

// Empty the whole trash.
filesRouter.delete(
  '/trash',
  asyncHandler(async (_req, res) => {
    await vault.emptyTrash();
    res.json({ ok: true });
  }),
);

filesRouter.delete(
  '/',
  asyncHandler(async (req, res) => {
    const rel = String(req.query.path ?? '');
    if (!rel) {
      res.status(400).json({ error: 'path required' });
      return;
    }
    const s = await getSettings();
    if (s.vault.deleteMode === 'permanent') {
      await vault.remove(rel);
      res.json({ ok: true, deleted: rel });
      return;
    }
    const dest = await vault.trash(rel);
    res.json({ ok: true, trashed: dest });
  }),
);
