import { fragmentRange, parseLinkTarget } from '@webobsidian/markdown-core';
import { api } from './api';
import { documents } from './documents';
import type { RenderContext } from './renderContext';
import { nativeTagMenuItems, openNativeTagPage, searchNativeTag, showNativeTagHover, hideNativeTagHover } from './tags/actions';
import { tagPreferences } from './nativeFeaturePreferences';
import { menuModifiers } from './configuredMenus/transform';
import { searchTags } from './search';

type Services = Pick<RenderContext, 'openMenu' | 'files' | 'reportError' | 'bindEditor'> & {
  openLink: (target: string, sourcePath?: string) => void;
  initialPropertyTypes?: Record<string, string>;
};
export function createVaultRenderContext(path: string, services: Services): RenderContext {
  let types = services.initialPropertyTypes ?? {};
  return {
    ...services, sourcePath: path, allowHtmlExecution: true, allowPlugins: true, openLink: target => services.openLink(target, path),
    tagMenu: (tag, event, source) => {
      services.openMenu({ x: event.clientX, y: event.clientY,
        items: nativeTagMenuItems({ tag, ...tagPreferences(), readonly: source === 'reading' }),
        context: { kind: 'tag-menu', tag, source, activePath: path, modifiers: menuModifiers(event) },
      });
    },
    openTag: (tag, toSide) => {
      if (tagPreferences().wranglerEnabled) void openNativeTagPage(tag, toSide, false);
      else searchNativeTag(tag);
    },
    tagHover: (tag, event) => { if (tagPreferences().wranglerEnabled) showNativeTagHover(tag, event); },
    tagLeave: hideNativeTagHover,
    rawUrl: target => api.rawUrl(target, path),
    tags: async () => searchTags(),
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
          const model = note.analysis;
          const range = fragmentRange(model, destination.fragment);
          return range ? { source: model.text.slice(range.from, range.to), from: range.from } : null;
        },
      };
    },
  };
}
