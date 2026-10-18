import { createHash } from 'node:crypto';
import { SourceDocument, analyzeMarkdown, embeddedTargets, fragmentRange, parseLinkTarget } from '@webobsidian/markdown-core';

export interface ShareDocument {
  token: string; path: string; source: string; from: number;
  notes: Map<string, string>; media: Map<string, string>;
}
interface Services { read: (path: string) => Promise<string>; resolve: (target: string, sourcePath: string) => string | undefined }

/** Capability graph is rebuilt from disk for every request: revocation is immediate. */
export async function buildShareScope(rootPath: string, services: Services): Promise<Map<string, ShareDocument>> {
  const scope = new Map<string, ShareDocument>();
  const visit = async (path: string, fragment: string, trail: string[], token?: string, inline?: string): Promise<string | null> => {
    if (trail.length > 4 || trail.includes(path) && inline === undefined) return null;
    const key = token ?? createHash('sha256').update(path + '#' + fragment).digest('hex').slice(0, 24);
    if (scope.has(key)) return key;
    let raw: string;
    try { raw = inline ?? await services.read(path); } catch { return null; }
    const model = analyzeMarkdown(new SourceDocument(raw).text);
    const range = fragmentRange(model, fragment); if (!range) return null;
    const document: ShareDocument = { token: key, path, source: model.text.slice(range.from, range.to), from: range.from, notes: new Map(), media: new Map() };
    scope.set(key, document);
    for (const target of embeddedTargets(document.source)) {
      const parsed = parseLinkTarget(target);
      const resolved = parsed.path ? services.resolve(parsed.path, path) : path;
      if (!resolved) continue;
      if (/\.(md|markdown)$/i.test(resolved)) {
        const child = await visit(resolved, parsed.fragment, [...trail, path]);
        if (child) document.notes.set(parsed.path + (parsed.fragment ? '#' + parsed.fragment : ''), child);
      } else document.media.set(parsed.path, resolved);
    }
    return key;
  };
  if (/\.canvas$/i.test(rootPath)) {
    const raw = await services.read(rootPath);
    const root: ShareDocument = { token: 'root', path: rootPath, source: raw, from: 0, notes: new Map(), media: new Map() }; scope.set('root', root);
    const data = JSON.parse(raw.replace(/^\ufeff/, ''));
    for (const node of data.nodes ?? []) {
      if (node.type === 'text' && typeof node.text === 'string') await visit(rootPath, '', [], 'canvas:' + node.id, node.text);
      if (node.type === 'file' && typeof node.file === 'string') {
        const resolved = services.resolve(node.file, rootPath); if (!resolved) continue;
        if (/\.(md|markdown)$/i.test(resolved)) {
          const token = await visit(resolved, String(node.subpath ?? '').replace(/^#/, ''), [rootPath]);
          if (token) root.notes.set('canvas:' + node.id, token);
        } else root.media.set(node.file, resolved);
      }
    }
  } else await visit(rootPath, '', [], 'root');
  return scope;
}
