import { api } from './api';
import { documents } from './documents';
import { renderMarkdown } from './markdown';
import type { RenderContext } from './renderContext';

export function createVaultRenderContext(
  path: string,
  services: Pick<RenderContext, 'openLink' | 'openMenu' | 'files' | 'reportError'> & { initialPropertyTypes?: Record<string, string> },
): RenderContext {
  let types: Record<string, string> = services.initialPropertyTypes ?? {};
  const resolveEmbed = async (target: string) => {
    const resolved = await api.resolve(target, path);
    if (!resolved.path) return null;
    const note = await documents.open(resolved.path);
    return { path: note.id, content: note.snapshot.raw };
  };
  return {
    ...services, sourcePath: path,
    rawUrl: (target) => api.rawUrl(target, path),
    tags: () => api.tags().then((r) => r.tags.map((t) => t.tag.replace(/^#/, ''))).catch(() => []),
    properties: () => api.properties().then((r) => r.properties).catch(() => []),
    propertyTypes: () => types,
    setPropertyType: async (key, type) => { types = (await api.setPropertyType(key, type)).types; return types; },
    renderEmbed: async (target, signal) => {
      try {
        const note = await resolveEmbed(target.split('#')[0].trim());
        if (!note || signal.aborted) return null;
        const stripped = note.content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
        const html = await renderMarkdown(stripped, { rawUrl: (p) => api.rawUrl(p, path), resolveEmbed });
        return signal.aborted ? null : { html };
      } catch { return null; }
    },
  };
}
