import { Router } from 'express';
import { asyncHandler } from '../middleware/error.js';
import { qmd } from '../services/search.js';
import { backlinksFor, graphData, resolveLink } from '../services/links.js';
import { resolveIndexedTarget } from '../services/fileindex.js';
import { readPropertyTypes, setPropertyType } from '../services/propertytypes.js';
import { notifyIndexChanged } from '../services/realtime.js';
import { rebuildFileIndexes } from '../services/fileupdates.js';
import { rebuildVaultIndex } from '../services/vaultindex.js';
import { catalog } from '../services/catalog.js';
import { getSettings } from '../services/settings.js';

export const searchRouter = Router();

searchRouter.get(
  '/search',
  asyncHandler(async (req, res) => {
    const q = String(req.query.q ?? '');
    // limit omitted / 0 → return every match; the client renders them incrementally.
    const limit = Math.max(0, Number(req.query.limit ?? 0) || 0);
    res.json({
      query: q,
      hits: await qmd.search(q, limit, req.query.mode === 'pinyin' ? 'pinyin' : 'literal'),
    });
  }),
);

// Per-note match contexts for the rendered batch of results (Obsidian-style
// grouped search). Reads bodies lazily so broad queries stay cheap.
searchRouter.post(
  '/search/matches',
  asyncHandler(async (req, res) => {
    const { query, paths, matchCase, phrase, mode } = req.body ?? {};
    // phrase=true → match the whole query as one needle (e.g. unlinked mentions
    // look for the exact note title, not each word of it).
    const terms = phrase
      ? [String(query ?? '').trim()].filter((t) => t.length >= 2)
      : qmd.queryTerms(String(query ?? ''));
    const list = (Array.isArray(paths) ? paths : []).slice(0, 80).map((p) => String(p));
    const chinese = !phrase && mode === 'pinyin' ? (await getSettings()).search.chinese : undefined;
    const matches = await Promise.all(
      list.map((p) =>
        qmd.matchesFor(p, terms, {
          caseSensitive: !!matchCase,
          pinyin: chinese?.enabled ? chinese : undefined,
          pinyinQuery: chinese?.enabled ? qmd.queryText(String(query ?? '')) : undefined,
        }),
      ),
    );
    res.json({ matches });
  }),
);

searchRouter.get(
  '/tags',
  asyncHandler(async (_req, res) => {
    res.json({ tags: qmd.allTags() });
  }),
);

searchRouter.get(
  '/properties',
  asyncHandler(async (_req, res) => {
    res.json({ properties: qmd.allProperties() });
  }),
);

searchRouter.get(
  '/property-types',
  asyncHandler(async (_req, res) => {
    res.json({ types: await readPropertyTypes() });
  }),
);

searchRouter.post(
  '/property-types',
  asyncHandler(async (req, res) => {
    const { key, type } = req.body ?? {};
    if (typeof key !== 'string' || typeof type !== 'string') {
      res.status(400).json({ error: 'key and type required' });
      return;
    }
    res.json({ types: await setPropertyType(key, type) });
  }),
);

searchRouter.get(
  '/backlinks',
  asyncHandler(async (req, res) => {
    const rel = String(req.query.path ?? '');
    res.json({ path: rel, backlinks: backlinksFor(rel) });
  }),
);

searchRouter.get(
  '/resolve',
  asyncHandler(async (req, res) => {
    const target = String(req.query.target ?? '');
    const sourcePath = String(req.query.sourcePath ?? '');
    const result = resolveIndexedTarget(target, sourcePath);
    res.json({
      target,
      path: result.status === 'resolved' ? result.path : null,
      status: result.status,
      candidates: result.candidates,
      fragment: result.fragment,
      normalizedTarget: result.path,
    });
  }),
);

searchRouter.get(
  '/graph',
  asyncHandler(async (_req, res) => {
    res.json(graphData());
  }),
);

searchRouter.post(
  '/reindex',
  asyncHandler(async (_req, res) => {
    await rebuildFileIndexes(async () => {
      await rebuildVaultIndex();
    });
    notifyIndexChanged();
    res.json({ ok: true });
  }),
);

searchRouter.get(
  '/catalog',
  asyncHandler(async (_req, res) => {
    res.json({
      entries: [...catalog.entries.values()].map(({ path, kind, title, aliases, tags, headings }) => ({
        path,
        kind,
        title,
        aliases,
        tags,
        headings,
      })),
    });
  }),
);
