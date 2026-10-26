import { contentTargets, isGlobalContentTarget, parseLinkTarget } from '@webobsidian/markdown-core';
import { api } from './api';
import { documents } from './documents';

export async function resolveContentLink(target: string, sourcePath: string) {
  const resolved = await api.resolve(target, sourcePath);
  if (!isGlobalContentTarget(target)) return resolved;
  const id = parseLinkTarget(target).fragment.slice(1);
  const opened = new Set(documents.snapshots().filter(snapshot => snapshot.dirty).map(snapshot => snapshot.id));
  const occurrences = (resolved.targetOccurrences ?? []).filter(item => !opened.has(item.path));
  for (const path of opened) {
    const session = documents.get(path);
    if (!session) continue;
    const result = contentTargets(session.analysis);
    for (const match of result.targets) if (match.id === id) occurrences.push({ path, valid: true });
    for (const issue of result.issues) if (issue.id === id) occurrences.push({ path, valid: false });
  }
  const candidates = [...new Set(occurrences.map(item => item.path))].sort();
  const unique = occurrences.length === 1 && occurrences[0].valid;
  return { ...resolved, path: unique ? occurrences[0].path : null,
    status: unique ? 'resolved' : occurrences.length ? 'ambiguous' : 'missing', candidates,
    targetOccurrences: occurrences };
}

export async function contentReferenceSuggestions(query: string) {
  const result = await api.contentTargets(query);
  const opened = new Set(documents.snapshots().filter(snapshot => snapshot.dirty).map(snapshot => snapshot.id));
  const targets = result.targets.filter(target => !opened.has(target.path));
  for (const path of opened) {
    const session = documents.get(path);
    if (!session) continue;
    for (const target of contentTargets(session.analysis).targets) targets.push({ ...target, path });
  }
  return targets;
}
