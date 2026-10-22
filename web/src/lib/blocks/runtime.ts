import type { App } from '../obsidian/runtime';
import { request } from '../api';
import { compileJavascript } from '../javascript/execute';
import { JavascriptRun } from '../javascript/lifetime';
import { refreshPluginMarkdown } from '../obsidian/markdown';
import { useStore } from '../store';
import { setBlockDefinitions, refreshBlockViews, type BlockDefinition, type LoadedBlockDefinition } from './model';

type Bundle = { vault: string; definitions: BlockDefinition[] };
let app: App | undefined;
let styles = '';
const documents = new Map<Document, { style: HTMLStyleElement; count: number }>();
function updateStyles() { for (const { style } of documents.values()) style.textContent = styles; }
export function attachBlockStyles(doc: Document) {
  let entry = documents.get(doc);
  if (!entry) {
    const style = doc.createElement('style'); style.dataset.nativeBlockEffects = 'true'; style.textContent = styles; doc.head.append(style);
    entry = { style, count: 0 }; documents.set(doc, entry);
  }
  entry.count++;
  return () => { if (entry && --entry.count === 0) { entry.style.remove(); documents.delete(doc); } };
}

/** Definitions compile once at reload, never once per rendered block. */
export function installBlockEffects(currentApp: App): () => void {
  app = currentApp;
  let stopped = false, generation = 0;
  let active = new Map<string, LoadedBlockDefinition>();
  const clear = () => { active.clear(); setBlockDefinitions([]); styles = ''; updateStyles(); refreshBlockViews(); refreshPluginMarkdown(); };
  const reload = async () => {
    const started = ++generation;
    try {
      const bundle = await request<Bundle>('/api/native-features/blocks');
      if (stopped || started !== generation) return;
      const loaded = bundle.definitions.map(d => {
        const previous = active.get(d.names[0]);
        if (previous && JSON.stringify(d) === JSON.stringify({ names: previous.names, classes: previous.classes, script: previous.script, code: previous.code, css: previous.css })) return previous;
        return { ...d, execute: d.code === undefined ? undefined : previous?.code === d.code ? previous.execute :
          compileJavascript(d.code, ['block'], 'vault-block/' + encodeURIComponent(d.script ?? d.names[0])) };
      });
      active = new Map(loaded.map(d => [d.names[0], d]));
      setBlockDefinitions(loaded); styles = [...new Set(loaded.map(d => d.css).filter(Boolean))].join('\n');
      updateStyles(); refreshBlockViews(); refreshPluginMarkdown();
    } catch (error) {
      if (stopped || started !== generation) return;
      // Never keep executing an obsolete definition after a malformed external edit.
      clear(); throw error;
    }
  };
  const stopCommand = currentApp.commands.register({ id: 'blocks:reload', name: '重新加载块效果配置', callback: reload });
  const onSwitch = () => { stopped = true; generation++; clear(); };
  window.addEventListener('vault-changed', onSwitch);
  void reload().catch(error => useStore.getState().notify('块效果配置：' + String(error)));
  return () => { onSwitch(); stopCommand(); window.removeEventListener('vault-changed', onSwitch); if (app === currentApp) app = undefined; };
}

/** Both fenced JS and configured effects use exactly the same run implementation. */
export function createEffectRun(container: HTMLElement, context: ConstructorParameters<typeof JavascriptRun>[2], invalidate: () => void, measure: () => void) {
  if (!app) throw new Error('Block effects are unavailable for this Vault');
  const run = new JavascriptRun(app, container, context, invalidate, measure); void run.load(); return run;
}
