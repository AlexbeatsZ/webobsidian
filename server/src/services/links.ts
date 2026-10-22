import path from 'node:path';
import { catalog } from './catalog.js';
import { readFileText } from './vault.js';
import { parseNote, linkKey, type ParsedNote } from './markdown.js';

interface LinkGraph {
  resolved: Map<string, Set<string>>;
  incoming: Map<string, Set<string>>;
  dependencies: Map<string, Set<string>>;
  sourceKeys: Map<string, Set<string>>;
}
const emptyGraph = (): LinkGraph => ({
  resolved: new Map(),
  incoming: new Map(),
  dependencies: new Map(),
  sourceKeys: new Map(),
});
let graph = emptyGraph();
export function rebuildGraphFromCatalog() {
  graph = emptyGraph();
  for (const rel of catalog.notes.keys()) updateResolvedSource(rel);
}
export async function buildLinkGraph() {
  const { rebuildVaultIndex } = await import('./vaultindex.js');
  await rebuildVaultIndex();
}

function removeResolvedSource(rel: string) {
  for (const target of graph.resolved.get(rel) ?? []) {
    const sources = graph.incoming.get(target);
    sources?.delete(rel);
    if (!sources?.size) graph.incoming.delete(target);
  }
  graph.resolved.delete(rel);
  for (const key of graph.sourceKeys.get(rel) ?? []) {
    const sources = graph.dependencies.get(key);
    sources?.delete(rel);
    if (!sources?.size) graph.dependencies.delete(key);
  }
  graph.sourceKeys.delete(rel);
}
function updateResolvedSource(rel: string) {
  removeResolvedSource(rel);
  const targets = new Set<string>(),
    keys = new Set<string>();
  for (const raw of catalog.notes.get(rel)?.links ?? []) {
    for (const key of catalog.targets.dependencies(raw, rel)) keys.add(key);
    const target = resolveLink(raw, rel);
    if (target) targets.add(target);
  }
  graph.resolved.set(rel, targets);
  for (const target of targets) {
    if (!graph.incoming.has(target)) graph.incoming.set(target, new Set());
    graph.incoming.get(target)!.add(rel);
  }
  graph.sourceKeys.set(rel, keys);
  for (const key of keys) {
    if (!graph.dependencies.has(key)) graph.dependencies.set(key, new Set());
    graph.dependencies.get(key)!.add(rel);
  }
}

/**
 * Incrementally update the link graph for a single markdown file. Far cheaper
 * than buildLinkGraph() (which re-reads every file in the vault) — used by the
 * fs watcher so an external edit doesn't reparse thousands of notes each time.
 */
export async function updateLinkGraphForFile(rel: string, removed = false): Promise<void> {
  if (removed) {
    updateLinkGraphFromNote(rel, undefined, true);
    return;
  }
  let note: ParsedNote | undefined;
  try {
    note = parseNote(rel, await readFileText(rel));
  } catch {
    /* retain empty node */
  }
  updateLinkGraphFromNote(rel, note);
}

export function updateLinkGraphFromNote(rel: string, note?: ParsedNote, removed = false): void {
  if (rel.split('/').some((seg) => seg.startsWith('.'))) return;
  const affected = new Set<string>([rel]);
  for (const key of catalog.targets.keysFor(rel))
    for (const source of graph.dependencies.get(key) ?? []) affected.add(source);
  if (removed) {
    catalog.remove(rel);
    removeResolvedSource(rel);
    affected.delete(rel);
  } else if (note && catalog.notes.get(rel)?.links !== note.links) catalog.putNote(rel, note);
  for (const source of affected) if (catalog.notes.has(source)) updateResolvedSource(source);
}
export function resolveLink(target: string, sourcePath = ''): string | undefined {
  const result = catalog.resolve(target, sourcePath, 'markdown');
  return result.status === 'resolved' ? result.path : undefined;
}

/** Notes that link *to* the given vault-relative path. */
export function backlinksFor(relative: string): string[] {
  return [...(graph.incoming.get(relative) ?? [])].filter((source) => source !== relative).sort();
}

/** node kinds drive client-side filtering (Tags / Attachments / Existing files only). */
export type GraphNodeKind = 'note' | 'attachment' | 'unresolved';

export interface GraphNode {
  id: string;
  label: string;
  kind: GraphNodeKind;
  tags: string[];
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** Embed targets ending in one of these are treated as attachment nodes, not notes. */
const ATTACHMENT_RE =
  /\.(png|jpe?g|gif|svg|webp|bmp|ico|avif|pdf|mp4|webm|mov|mkv|mp3|wav|ogg|m4a|flac|zip|docx?|xlsx?|pptx?)$/i;

export function graphData(): GraphData {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const seenNode = new Set<string>();
  const seenEdge = new Set<string>();

  const addNode = (n: GraphNode) => {
    if (seenNode.has(n.id)) return;
    seenNode.add(n.id);
    nodes.push(n);
  };
  const addEdge = (source: string, target: string) => {
    if (source === target) return;
    const k = `${source}\0${target}`;
    if (seenEdge.has(k)) return;
    seenEdge.add(k);
    edges.push({ source, target });
  };

  for (const rel of catalog.notes.keys()) {
    addNode({
      id: rel,
      label: path.basename(rel).replace(/\.(md|markdown)$/i, ''),
      kind: 'note',
      tags: catalog.notes.get(rel)?.tags ?? [],
    });
  }

  for (const [source, record] of catalog.notes) {
    const targets = record.links;
    for (const target of targets) {
      const dest = resolveLink(target, source);
      if (dest) {
        addEdge(source, dest);
      } else if (ATTACHMENT_RE.test(target)) {
        const id = `attachment:${target.toLowerCase()}`;
        addNode({ id, label: path.basename(target), kind: 'attachment', tags: [] });
        addEdge(source, id);
      } else {
        const id = `unresolved:${linkKey(target)}`;
        addNode({ id, label: target, kind: 'unresolved', tags: [] });
        addEdge(source, id);
      }
    }
  }

  return { nodes, edges };
}
