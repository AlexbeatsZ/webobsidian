import { analyzeMarkdown, fragmentRange, parseLinkTarget } from '@webobsidian/markdown-core';
import { api } from './api';
import { documents } from './documents';
import type { RenderContext } from './renderContext';

type Services = Pick<RenderContext, 'openMenu' | 'files' | 'reportError' | 'bindEditor'> & {
  openLink: (target: string, sourcePath?: string) => void;
  initialPropertyTypes?: Record<string, string>;
};
export function createVaultRenderContext(path: string, services: Services): RenderContext {
  let types = services.initialPropertyTypes ?? {};
  return {
    ...services, sourcePath: path, allowHtmlExecution: true, openLink: target => services.openLink(target, path),
    rawUrl: target => api.rawUrl(target, path),
    tags: () => api.tags().then(r => r.tags.map(t => t.tag.replace(/^#/, ''))).catch(() => []),
    properties: () => api.properties().then(r => r.properties).catch(() => []),
    propertyTypes: () => types,
    setPropertyType: async (key, type) => { types = (await api.setPropertyType(key, type)).types; return types; },
    renderEmbed: async (target, signal) => {
      const destination = parseLinkTarget(target);
      const resolved = destination.path ? await api.resolve(target, path) : { path };
      if (!resolved.path || signal.aborted) return null;
      const note = await documents.open(resolved.path);
      if (signal.aborted) return null;
      return {
        path: note.id, context: createVaultRenderContext(note.id, services), subscribe: note.subscribe,
        read: () => {
          const model = analyzeMarkdown(note.snapshot.text, note.id, note.snapshot.version);
          const range = fragmentRange(model, destination.fragment);
          return range ? { source: model.text.slice(range.from, range.to), from: range.from } : null;
        },
      };
    },
  };
}
