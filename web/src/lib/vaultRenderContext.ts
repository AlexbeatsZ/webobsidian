import { fragmentRange, parseLinkTarget, equationContext, contentTargets, isGlobalContentTarget, type DocumentSession, type MarkdownModel } from '@webobsidian/markdown-core';
import { api } from './api';
import { documents } from './documents';
import { resolveContentLink } from './contentReferences';
import type { RenderContext } from './renderContext';
import { nativeTagMenuItems, openNativeTagPage, searchNativeTag, showNativeTagHover, hideNativeTagHover } from './tags/actions';
import { tagPreferences } from './nativeFeaturePreferences';
import { menuModifiers } from './configuredMenus/transform';
import { searchTags, subscribeSearch } from './search';
import { propertyTypesSnapshot, setPropertyType } from './propertyTypes';
import type { LinkIntent } from './fragmentNavigation';

type Services = Pick<RenderContext, 'openMenu' | 'files' | 'reportError' | 'bindEditor'> & {
  openLink: (target: string, sourcePath?: string, intent?: LinkIntent) => void;
};
export function createVaultRenderContext(path: string, services: Services): RenderContext {
  return {
    ...services, sourcePath: path, allowHtmlExecution: true, allowScriptExecution: true, allowBlockEffects: true, allowPlugins: true, openLink: (target, intent) => services.openLink(target, path, intent),
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
    propertyTypes: propertyTypesSnapshot,
    setPropertyType,
    renderEmbed: async (target, signal) => {
      const destination = parseLinkTarget(target);
      const global = isGlobalContentTarget(target), id = destination.fragment.slice(1);
      const resolved = await resolveContentLink(target, path);
      if ((!resolved.path && !global) || signal.aborted) return null;
      let note = resolved.path ? await documents.open(resolved.path) : undefined;
      if (signal.aborted) return null;
      let sourcePath = resolved.path ?? '', valid = !!note, generation = 0, queued = false;
      const listeners = new Set<() => void>();
      const notify = () => { for (const listener of listeners) listener(); };
      const signature = (session: DocumentSession) => {
        const targets = contentTargets(session.analysis);
        return targets.targets.filter(item => item.id === id).length + ':' + targets.issues.filter(item => item.id === id).length;
      };
      const signatures = new WeakMap<DocumentSession, string>();
      if (global) for (const snapshot of documents.snapshots()) {
        const session = documents.get(snapshot.id); if (session) signatures.set(session, signature(session));
      }
      const currentRange = (model: MarkdownModel) => valid && note && !signal.aborted && note.id === sourcePath && documents.get(sourcePath) === note
        ? fragmentRange(model, destination.fragment) : null;
      let stopNote: (() => void) | undefined, stopDocuments: (() => void) | undefined, stopSearch: (() => void) | undefined;
      const follow = () => {
        stopNote?.();
        const session = note;
        stopNote = session?.subscribe(() => {
          if (!currentRange(session.analysis)) { valid = false; requestResolution(); }
          notify();
        });
      };
      const requestResolution = () => {
        if (queued || signal.aborted || !listeners.size) return;
        queued = true;
        const request = ++generation;
        queueMicrotask(() => {
          queued = false;
          if (signal.aborted || !listeners.size || request !== generation) return;
          void resolveContentLink(target, path).then(async result => {
            const next = result.path ? await documents.open(result.path) : undefined;
            if (signal.aborted || !listeners.size || request !== generation) return;
            valid = !!next;
            if (next) { note = next; sourcePath = result.path!; follow(); }
            notify();
          }).catch(error => {
            if (signal.aborted || request !== generation) return;
            valid = false; notify(); services.reportError?.(String(error));
          });
        });
      };
      const stop = () => { generation++; queued = false; stopNote?.(); stopDocuments?.(); stopSearch?.(); };
      signal.addEventListener('abort', stop, { once: true });
      return {
        get edit() {
          if (!note || !valid) return undefined;
          const session = note, source = sourcePath;
          return { session, resolveRange: (model: MarkdownModel) => note === session && source === sourcePath ? currentRange(model) : null };
        },
        get path() { return sourcePath; }, get context() { return createVaultRenderContext(sourcePath || path, services); },
        subscribe: listener => {
          if (signal.aborted) return () => {};
          listeners.add(listener);
          if (listeners.size === 1) {
            follow();
            stopDocuments = documents.subscribe(snapshot => {
              const session = documents.get(snapshot.id);
              if (!global || !session) return;
              const next = signature(session), before = signatures.get(session) ?? '0:0';
              signatures.set(session, next);
              if (next !== before) { valid = false; notify(); requestResolution(); }
            });
            stopSearch = subscribeSearch(requestResolution);
            if (!valid) requestResolution();
          }
          return () => { listeners.delete(listener); if (!listeners.size) stop(); };
        },
        read: () => {
          if (!note) return null;
          const model = note.analysis;
          const range = currentRange(model);
          return range ? { source: model.text.slice(range.from, range.to), from: range.from,
            equations: equationContext(model, range.from), mathSource: { model, from: range.from } } : null;
        },
      };
    },
  };
}
