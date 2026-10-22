import { mountMarkdownFragment } from './components/MarkdownFragment';
import type { RenderContext } from './lib/renderContext';
import './styles/obsidian.css';
import { activateMathProfile } from './lib/mathjax';
import type { MathProfile } from './lib/mathPreamble';

interface SharedDocument { token: string; source: string; from: number; notes: Record<string, string> }
interface SharedPayload { kind: 'markdown' | 'canvas'; documents: SharedDocument[]; mathProfile?: MathProfile }

/** No vault/store/authenticated API imports. Every operation is share-scoped. */
export async function enhanceSharedPage(id: string, payload?: SharedPayload): Promise<void> {
  let result = payload;
  if (!result) {
    const response = await fetch('/public/shares/' + encodeURIComponent(id) + '/render', { credentials: 'same-origin' });
    if (!response.ok) throw new Error('Share unavailable');
    result = await response.json() as SharedPayload;
  }
  if (result.mathProfile) await activateMathProfile(result.mathProfile);
  const docs = new Map(result.documents.map(doc => [doc.token, doc]));
  const root = docs.get('root'); if (!root) return;
  const stops: (() => void)[] = [];
  const contextFor = (token: string): RenderContext => ({
    sourcePath: token, openLink: target => { if (target.startsWith('#')) location.hash = target.slice(1); },
    openMenu: () => {}, files: () => [], tags: async () => [], properties: async () => [], propertyTypes: () => ({}),
    setPropertyType: async () => { throw new Error('This share is read-only'); },
    rawUrl: target => '/public/shares/' + encodeURIComponent(id) + '/file?from=' + encodeURIComponent(token) + '&path=' + encodeURIComponent(target),
    renderEmbed: async (target, signal) => {
      const child = docs.get(docs.get(token)?.notes[target] ?? ''); if (!child || signal.aborted) return null;
      return { path: child.token, context: contextFor(child.token), read: () => ({ source: child.source, from: child.from }), subscribe: () => () => {} };
    },
  });
  const mount = (host: HTMLElement, doc: SharedDocument) => {
    const content = document.createElement('div');
    // Keep crawler/fallback HTML until the shared engine has mounted successfully.
    stops.push(mountMarkdownFragment(content, doc.source, { id: doc.token, sourceFrom: doc.from, context: contextFor(doc.token),
      onReady: () => host.replaceChildren(content) }));
  };
  if (result.kind === 'markdown') {
    const host = document.getElementById('shared-markdown'); if (host) mount(host, root);
  } else {
    const canvas = JSON.parse(root.source.replace(/^\ufeff/, ''));
    for (const node of canvas.nodes ?? []) {
      const host = [...document.querySelectorAll<HTMLElement>('[data-share-node]')].find(el => el.dataset.shareNode === node.id);
      const token = node.type === 'text' ? 'canvas:' + node.id : root.notes['canvas:' + node.id];
      const doc = docs.get(token); if (host && doc) mount(host, doc);
    }
  }
  window.addEventListener('pagehide', () => stops.forEach(stop => stop()), { once: true });
}

const host = document.querySelector<HTMLElement>('[data-share-id]');
if (host?.dataset.shareId) void enhanceSharedPage(host.dataset.shareId).catch(() => { /* Retain complete SSR fallback on failure. */ });
