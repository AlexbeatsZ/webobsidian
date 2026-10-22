import { matchName } from '../search';
import { runWritingCommand } from '../writing/commands';
import { nativeCommands, runNativeCommand } from '../nativeCommands';
import { adaptNativePlusModules, migratedPluginIds } from '../nativePluginPolicy';
import * as cmState from '@codemirror/state';
import * as cmView from '@codemirror/view';
import * as cmLanguage from '@codemirror/language';
import * as cmCommands from '@codemirror/commands';
import * as cmSearch from '@codemirror/search';
import * as cmAutocomplete from '@codemirror/autocomplete';
import * as cmLint from '@codemirror/lint';
import * as lezerCommon from '@lezer/common';
import * as lezerHighlight from '@lezer/highlight';
import * as lezerLR from '@lezer/lr';
import moment from 'moment';
import CodeMirror from 'codemirror';
import 'codemirror/mode/javascript/javascript';
import TurndownService from 'turndown';
import { sanitizeHtmlFragment } from '@webobsidian/markdown-core';
import { api } from '../api';
import { useStore } from '../store';
import { mountMarkdownFragment } from '../../components/MarkdownFragment';
import { createVaultRenderContext } from '../vaultRenderContext';
import { renderMath as renderMathInto, loadMathJax as loadMathJaxRuntime } from '../mathjax';
import { livePreviewState } from '../livePreview';
import * as events from './events';
import * as ui from './ui';
import * as dom from './dom';
import * as files from './vault';
import * as workspace from './workspace';
import * as editor from './editor';
import * as markdown from './markdown';
import { WebViewerView, promptWebViewer } from './webviewer';
import { bindPluginMenus } from './menus';

type Command = {
  id: string;
  name: string;
  hotkeys?: { modifiers: string[]; key: string }[];
  callback?: () => any;
  checkCallback?: (checking: boolean) => any;
  editorCallback?: (editor: editor.Editor, view: workspace.MarkdownView) => any;
  editorCheckCallback?: (checking: boolean, editor: editor.Editor, view: workspace.MarkdownView) => any;
};
export type PluginStatus = {
  id: string;
  state: 'loading' | 'loaded' | 'disabled' | 'error' | 'unsupported' | 'builtin';
  error?: string;
};
const listeners = new Set<() => void>();
let revision = 0;
function changed() {
  revision++;
  listeners.forEach((cb) => cb());
}
export const subscribePlugins = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};
export const pluginRevision = () => revision;
export const pluginStatuses = new Map<string, PluginStatus>();
const loaded = new Map<string, Plugin>(),
  pending = new Map<string, Promise<void>>();
export const pluginCommands = new Map<string, Command>();
export const pluginTabs = new Map<string, ui.PluginSettingTab>();
export const pluginRibbon = new Map<string, HTMLElement[]>();
export const pluginStatusItems = new Map<string, HTMLElement[]>();
function fail(id: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  pluginStatuses.set(id, { id, state: 'error', error: message });
  console.error(`[plugin:${id}]`, error);
  changed();
}
export function runPluginCommand(id: string, checking = false): boolean {
  const command = pluginCommands.get(id);
  if (!command) return false;
  const view = sharedApp.workspace.getActiveViewOfType(workspace.MarkdownView);
  try {
    const check = (result: any) => {
      if (!checking && result?.then) Promise.resolve(result).catch((e) => fail(id.split(':')[0], e));
      return result !== false;
    };
    if (command.editorCheckCallback)
      return (
        !!view &&
        !view.editor.cm.state.readOnly &&
        check(command.editorCheckCallback(checking, view.editor, view))
      );
    if (command.checkCallback) return check(command.checkCallback(checking));
    if (command.editorCallback) {
      if (!view || view.editor.cm.state.readOnly) return false;
      if (!checking)
        Promise.resolve(command.editorCallback(view.editor, view)).catch((e) => fail(id.split(':')[0], e));
      return true;
    }
    if (command.callback) {
      if (!checking) Promise.resolve(command.callback()).catch((e) => fail(id.split(':')[0], e));
      return true;
    }
  } catch (e) {
    fail(id.split(':')[0], e);
  }
  return false;
}
export class Plugin extends events.Component {
  private extensions: cmState.Extension[] = [];
  constructor(
    public app: App,
    public manifest: any,
  ) {
    super();
  }
  addCommand(command: Command) {
    const cmd = { ...command, id: `${this.manifest.id}:${command.id}` };
    pluginCommands.set(cmd.id, cmd);
    this.register(() => {
      if (pluginCommands.get(cmd.id) === cmd) pluginCommands.delete(cmd.id);
      changed();
    });
    changed();
    return cmd;
  }
  removeCommand(id: string) {
    pluginCommands.delete(`${this.manifest.id}:${id}`);
    changed();
  }
  addSettingTab(tab: ui.PluginSettingTab) {
    const key = tab.id || this.manifest.id;
    pluginTabs.set(key, tab);
    this.register(() => {
      tab.hide();
      tab.containerEl.remove();
      pluginTabs.delete(key);
      changed();
    });
    changed();
  }
  async loadData() {
    return (await api.pluginData(this.manifest.id)).data;
  }
  async saveData(data: unknown) {
    await api.savePluginData(this.manifest.id, data);
  }
  registerEditorExtension(extension: cmState.Extension) {
    this.extensions.push(extension);
    editor.setPluginExtensions(this, this.extensions);
    this.register(() => editor.setPluginExtensions(this, []));
  }
  registerMarkdownPostProcessor(callback: any, sortOrder = 0) {
    return markdown.registerPostProcessor(this, callback, sortOrder);
  }
  registerMarkdownCodeBlockProcessor(language: string, callback: any, sortOrder = 0) {
    return markdown.registerCodeProcessor(this, language, callback, sortOrder);
  }
  registerView(type: string, creator: any) {
    if (this.app.workspace.viewRegistry.has(type)) throw new Error(`View already registered: ${type}`);
    this.app.workspace.viewRegistry.set(type, creator);
    this.register(() => {
      this.app.workspace.detachLeavesOfType(type);
      this.app.workspace.viewRegistry.delete(type);
    });
  }
  registerExtensions(_extensions: string[], _view: string) {
    throw new Error('Custom file extension associations are not supported yet');
  }
  registerEditorSuggest(suggest: EditorSuggest) {
    this.app.workspace.editorSuggest.suggests.push(suggest);
    this.register(() => {
      const list = this.app.workspace.editorSuggest.suggests;
      const at = list.indexOf(suggest);
      if (at >= 0) list.splice(at, 1);
    });
    this.addChild(suggest);
    void suggest.load();
    this.registerEditorExtension(
      cmView.EditorView.updateListener.of((update) => {
        if (update.docChanged || update.selectionSet) void suggest.update(update.view);
      }),
    );
  }
  private addElement(map: Map<string, HTMLElement[]>, el: HTMLElement) {
    const list = map.get(this.manifest.id) ?? [];
    list.push(el);
    map.set(this.manifest.id, list);
    this.register(() => {
      el.remove();
      map.set(
        this.manifest.id,
        (map.get(this.manifest.id) ?? []).filter((e) => e !== el),
      );
      changed();
    });
    changed();
    return el;
  }
  addRibbonIcon(icon: string, title: string, cb: (e: MouseEvent) => void) {
    const el = dom.createEl('button', {
      title,
      cls: 'clickable-icon',
      attr: { 'aria-label': title },
    });
    ui.setIcon(el, icon);
    el.onclick = cb;
    return this.addElement(pluginRibbon, el);
  }
  addStatusBarItem() {
    return this.addElement(pluginStatusItems, dom.createDiv({ cls: 'status-bar-item' }));
  }
  registerObsidianProtocolHandler(action: string, handler: (params: any) => any) {
    this.app.protocolHandlers.set(action, handler);
    this.register(() => this.app.protocolHandlers.delete(action));
  }
  registerCliHandler(id: string, description: string, parameters: any, callback: Function) {
    this.app.cliHandlers.set(id, { description, parameters, callback });
    this.register(() => this.app.cliHandlers.delete(id));
  }
}
export class EditorSuggest extends events.Component {
  private results: any[] = [];
  suggestions = {
    useSelectedItem: (event: any) => {
      if (this.results.length) this.selectSuggestion(this.results[0], event);
    },
    setSuggestions: (values: any[]) => {
      this.results = values;
    },
  };
  setInstructions(items: any[]) {
    this.suggestEl.setAttribute(
      'aria-description',
      items.map((i) => `${i.command}: ${i.purpose}`).join('; '),
    );
    return this;
  }
  context: any = null;
  limit = 100;
  scope = new ui.Scope();
  suggestEl: HTMLElement = dom.createDiv({
    cls: 'suggestion-container plugin-editor-suggest',
  });
  private generation = 0;
  constructor(public app: App) {
    super();
  }
  onTrigger(_cursor: any, _editor: editor.Editor, _file: files.TFile): any {
    return null;
  }
  getSuggestions(_context: any): any[] | Promise<any[]> {
    return [];
  }
  renderSuggestion(value: any, el: HTMLElement) {
    el.textContent = String(value);
  }
  selectSuggestion(_value: any, _event: MouseEvent | KeyboardEvent) {}
  async update(cm: cmView.EditorView) {
    if (!cm.hasFocus || cm.state.readOnly) return this.close();
    const current = ++this.generation;
    const ed = new editor.Editor(cm);
    const file = this.app.vault.getFileByPath(ed.sourcePath);
    const ctx = file && this.onTrigger(ed.getCursor(), ed, file);
    if (!ctx) return this.close();
    this.context = { ...ctx, editor: ed, file };
    const result = await this.getSuggestions(this.context);
    if (current !== this.generation) return;
    this.results = result.slice(0, this.limit);
    this.suggestEl.replaceChildren();
    for (const item of this.results) {
      const el = dom.createDiv({
        cls: 'suggestion-item',
        parent: this.suggestEl,
      });
      this.renderSuggestion(item, el);
      el.onmousedown = (e: MouseEvent) => {
        e.preventDefault();
        this.selectSuggestion(item, e);
        this.close();
      };
    }
    const rect = cm.coordsAtPos(cm.state.selection.main.head);
    if (rect)
      Object.assign(this.suggestEl.style, {
        position: 'fixed',
        left: rect.left + 'px',
        top: rect.bottom + 'px',
        zIndex: '10000',
      });
    document.body.append(this.suggestEl);
  }
  close() {
    this.generation++;
    this.context = null;
    this.results = [];
    this.suggestEl.remove();
  }
  onunload() {
    this.close();
  }
}
class CommandManager extends events.Events {
  get commands() {
    return Object.fromEntries(this.listCommands().map(command => [command.id, command]));
  }
  listCommands() {
    return [
      ...nativeCommands.map(command => ({ id: command.id, name: command.title, callback: command.run })),
      ...[...pluginCommands.values()].filter(command => !nativeCommands.some(native => native.id === command.id)),
    ];
  }
  executeCommandById(id: string) {
    if (runNativeCommand(id)) return true;
    if (runWritingCommand(id)) return true;
    if (id === 'editor:save-file') {
      void useStore.getState().save();
      return true;
    }
    if (id === 'command-palette:open') {
      useStore.getState().setPalette(true, 'commands');
      return true;
    }
    if (id === 'switcher:open') {
      useStore.getState().setPalette(true, 'files');
      return true;
    }
    return runPluginCommand(id);
  }
  findCommand(id: string) {
    return this.listCommands().find(command => command.id === id);
  }
}
export class App {
  vault = new files.Vault();
  metadataCache = new files.MetadataCache(this.vault);
  workspace = new workspace.Workspace(this);
  commands = new CommandManager();
  scope = new ui.Scope();
  protocolHandlers = new Map<string, Function>();
  cliHandlers = new Map<string, any>();
  loadLocalStorage(key: string) {
    const value = localStorage.getItem(`obsidian:${this.vault.adapter.basePath}:${key}`);
    if (value === null) return null;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  saveLocalStorage(key: string, value: any) {
    localStorage.setItem(`obsidian:${this.vault.adapter.basePath}:${key}`, JSON.stringify(value));
  }
  keymap = {
    pushScope: (scope: ui.Scope) => {
      this.scope = scope;
    },
    popScope: (scope: ui.Scope) => {
      if (this.scope === scope) this.scope = scope.parent ?? new ui.Scope();
    },
  };
  plugins = {
    plugins: Object.create(null) as Record<string, Plugin>,
    manifests: Object.create(null) as Record<string, any>,
    enabledPlugins: new Set<string>(),
    getPlugin: (id: string) => this.plugins.plugins[id] ?? null,
    enablePlugin: (id: string) => setPluginEnabled(id, true),
    disablePlugin: (id: string) => setPluginEnabled(id, false),
    enablePluginAndSave: (id: string) => setPluginEnabled(id, true),
    disablePluginAndSave: (id: string) => setPluginEnabled(id, false),
  };
  setting = {
    settingTabs: [] as ui.PluginSettingTab[],
    pluginTabs: [] as ui.PluginSettingTab[],
    activeTab: null as ui.PluginSettingTab | null,
    open: () => useStore.getState().setSettings(true),
    close: () => useStore.getState().setSettings(false),
    openTabById: (id: string) => openPluginSettings(id),
  };
  internalPlugins = {
    plugins: Object.create(null),
    getPluginById: (id: string): any => this.internalPlugins.plugins[id] ?? null,
    getEnabledPluginById: (id: string): any => this.internalPlugins.plugins[id]?.instance ?? null,
  };
  hotkeyManager = {
    customKeys: {} as Record<string, any>,
    getHotkeys: (id: string) => pluginCommands.get(id)?.hotkeys ?? [],
    getDefaultHotkeys: (id: string) => pluginCommands.get(id)?.hotkeys ?? [],
  };
  fileManager = {
    renameFile: (file: files.TAbstractFile, path: string) => this.vault.rename(file, path),
    trashFile: (file: files.TAbstractFile) => this.vault.trash(file),
    generateMarkdownLink: (file: files.TFile, source: string, subpath = '', alias = '') =>
      `[[${this.metadataCache.fileToLinktext(file, source, true)}${subpath}${alias ? '|' + alias : ''}]]`,
    getNewFileParent: (source = '') =>
      this.vault.getFolderByPath(source.split('/').slice(0, -1).join('/')) ?? this.vault.getRoot(),
    processFrontMatter: async (file: files.TFile, fn: (fm: any) => void) => {
      await this.vault.process(file, (source) => {
        const info = files.getFrontMatterInfo(source);
        const fm = info.exists ? (files.parseYaml(info.frontmatter) ?? {}) : {};
        fn(fm);
        const ending = source.includes('\r\n') ? '\r\n' : '\n';
        return (
          '---' +
          ending +
          files.stringifyYaml(fm).replace(/\n/g, ending) +
          '---' +
          ending +
          source.slice(info.contentStart)
        );
      });
    },
  };
  isDarkMode() {
    return document.body.classList.contains('theme-dark') || !!document.querySelector('.theme-dark');
  }
}
export const sharedApp = new App();
export async function loadMathJax() {
  const math: any = await loadMathJaxRuntime();
  // This host renders math with SVG. Existing preamble plugins use tex2chtml
  // only to register TeX definitions; run them through the same TeX input jax.
  if (!math.tex2chtml && math.tex2svg)
    math.tex2chtml = (tex: string, options: any) => math.tex2svg(tex, options);
  return math;
}
export function openPluginSettings(id: string) {
  if (!pluginTabs.has(id)) return;
  useStore.getState().setSettings(true);
  window.dispatchEvent(new CustomEvent('plugin-settings-open', { detail: id }));
}
function debounce<T extends (...args: any[]) => any>(callback: T, delay = 0, resetTimer = false) {
  let timer: number | undefined;
  let args: any[];
  const fn = (...values: any[]) => {
    args = values;
    if (timer !== undefined && !resetTimer) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = undefined;
      callback(...args);
    }, delay);
  };
  fn.cancel = () => {
    window.clearTimeout(timer);
    timer = undefined;
  };
  fn.run = () => {
    fn.cancel();
    callback(...args);
  };
  return fn;
}
export const Platform = {
  isDesktop: false,
  isDesktopApp: false,
  isMobile: false,
  isMobileApp: false,
  isPhone: false,
  isTablet: false,
  isWin: /Win/.test(navigator.platform),
  isMacOS: /Mac/.test(navigator.platform),
  isLinux: /Linux/.test(navigator.platform),
  isAndroidApp: false,
  isIosApp: false,
  isSafari: /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent),
  resourcePathPrefix: '',
};
const nativeRequire = (window as any).webobsidianNativeRequire as ((name: string) => any) | undefined;
if (nativeRequire) {
  Platform.isDesktop = true;
  Platform.isDesktopApp = true;
}
export async function requestUrl(input: string | any) {
  const options = typeof input === 'string' ? { url: input } : input;
  const result = nativeRequire
    ? await nativeRequire('electron').ipcRenderer.invoke('desktop:plugin-request', options)
    : await api.pluginRequest(options);
  const arrayBuffer = Uint8Array.from(atob(result.base64), (c) => c.charCodeAt(0)).buffer;
  const text = new TextDecoder().decode(arrayBuffer);
  if (options.throw !== false && result.status >= 400)
    throw new Error(`Request failed, status ${result.status}`);
  return {
    status: result.status,
    headers: result.headers,
    arrayBuffer,
    text,
    get json() {
      return JSON.parse(text);
    },
  };
}
export const MarkdownRenderer = {
  async render(_app: App, source: string, el: HTMLElement, sourcePath: string, component: events.Component) {
    const context = createVaultRenderContext(sourcePath, {
      files: () => sharedApp.vault.getFiles().map((f) => f.path),
      openLink: (target) => {
        void sharedApp.workspace.openLinkText(target, sourcePath);
      },
      openMenu: (menu) => useStore.getState().openContextMenu(menu),
    });
    await new Promise<void>((resolve) => {
      const stop = mountMarkdownFragment(el, source, {
        id: sourcePath || 'plugin.md',
        context,
        onReady: resolve,
      });
      component.register(stop);
    });
  },
  async renderMarkdown(source: string, el: HTMLElement, path: string, component: events.Component) {
    await MarkdownRenderer.render(sharedApp, source, el, path, component);
  },
};
const mathPromises = new Set<Promise<void>>();
function renderMath(source: string, display: boolean) {
  const el = dom.createSpan({
    cls: display ? 'math math-block' : 'math math-inline',
  });
  el.dataset.latex = source;
  const promise = renderMathInto(el, source, display, new AbortController().signal);
  mathPromises.add(promise);
  void promise.finally(() => mathPromises.delete(promise));
  return el;
}
export const obsidianModule: Record<string, any> = {
  ...events,
  ...ui,
  ...dom,
  ...files,
  ...workspace,
  ...editor,
  Plugin,
  App,
  EditorSuggest,
  MarkdownRenderer,
  MarkdownRenderChild: markdown.MarkdownRenderChild,
  moment,
  Platform,
  debounce,
  requestUrl,
  request: async (opts: any) => (await requestUrl(opts)).text,
  apiVersion: '1.8.7',
  requireApiVersion: (version: string) => version.localeCompare('1.8.7', undefined, { numeric: true }) <= 0,
  getLanguage: () => navigator.language.split('-')[0],
  livePreviewState,
  loadMathJax,
  renderMath,
  finishRenderMath: async () => {
    await Promise.all(mathPromises);
  },
  loadMermaid: async () => (await import('mermaid')).default,
  sanitizeHTMLToDom: (html: string) => {
    const template = document.createElement('template');
    template.innerHTML = sanitizeHtmlFragment(html, (path) => path);
    return template.content;
  },
  htmlToMarkdown: (html: string) => new TurndownService().turndown(html),
  getLinkpath: (text: string) => files.parseLinktext(text).path,
  arrayBufferToBase64: (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))),
  base64ToArrayBuffer: (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0)).buffer,
  prepareFuzzySearch: (query: string) => (text: string) => matchName(query, text),
  prepareSimpleSearch: (query: string) => (text: string) => {
    const at = text.toLowerCase().indexOf(query.toLowerCase());
    return at < 0 ? null : { score: 1, matches: [[at, at + query.length]] };
  },
  renderMatches: (el: HTMLElement, text: string, matches: [number, number][] = []) => {
    el.replaceChildren();
    let at = 0;
    for (const [a, b] of matches) {
      const start = Math.max(at, a),
        end = Math.min(text.length, b);
      if (end <= start) continue;
      el.append(document.createTextNode(text.slice(at, start)));
      const span = document.createElement('span');
      span.className = 'suggestion-highlight';
      span.textContent = text.slice(start, end);
      el.append(span);
      at = end;
    }
    el.append(document.createTextNode(text.slice(at)));
  },
};
const tokenClassNodeProp = new lezerCommon.NodeProp<string>();
const modules: Record<string, any> = {
  obsidian: obsidianModule,
  moment: moment,
  '@codemirror/state': cmState,
  '@codemirror/view': cmView,
  '@codemirror/language': { ...cmLanguage, tokenClassNodeProp },
  '@codemirror/commands': cmCommands,
  '@codemirror/search': cmSearch,
  '@codemirror/autocomplete': cmAutocomplete,
  '@codemirror/lint': cmLint,
  '@lezer/common': lezerCommon,
  '@lezer/highlight': lezerHighlight,
  '@lezer/lr': lezerLR,
};
modules.util = {
  promisify:
    (fn: Function) =>
    (...args: any[]) =>
      new Promise((resolve, reject) =>
        fn(...args, (error: any, value: any) => (error ? reject(error) : resolve(value))),
      ),
};
modules.child_process = {
  exec: (...args: any[]) => {
    const error = new Error('Shell commands require native desktop plugins to be enabled');
    const cb = args.at(-1);
    if (typeof cb === 'function') cb(error);
    else throw error;
  },
};
dom.installDomHelpers();
Object.assign(window, {
  CodeMirror,
  CodeMirrorAdapter: {
    commands: {
      save: () => sharedApp.commands.executeCommandById('editor:save-file'),
    },
  },
});
export const nativePluginReplacements:Record<string,string>={
  ...migratedPluginIds,
  'fuzzy-chinese-pinyin':'已由内置中文搜索接管',
  'obsidian-latex-suite':'已由内置公式与片段接管',
  'obsidian-linter':'已由内置文档格式化接管',
};
export async function loadPlugin(id:string,manifest:any){
  if(nativePluginReplacements[id]){pluginStatuses.set(id,{id,state:'builtin',error:nativePluginReplacements[id]});changed();return;}
  if (loaded.has(id)) return;
  if (pending.has(id)) return pending.get(id);
  const operation = (async () => {
    pluginStatuses.set(id, { id, state: 'loading' });
    changed();
    if (manifest.isDesktopOnly && !Platform.isDesktopApp) {
      pluginStatuses.set(id, {
        id,
        state: 'unsupported',
        error: 'Requires the native desktop plugin host',
      });
      changed();
      return;
    }
    let instance: Plugin | undefined;
    try {
      const response = await fetch(`/api/plugins/${encodeURIComponent(id)}/main.js`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error(`Plugin source: HTTP ${response.status}`);
      const code = await response.text(),
        module = { exports: {} as any };
      const root = sharedApp.vault.adapter.basePath.replace(/\\/g, '/') + `/.obsidian/plugins/${id}`;
      const native = nativeRequire?.('node:module').createRequire(root + '/main.js');
      const require = (name: string) => {
        if (
          native &&
          !(
            name === 'obsidian' ||
            name === 'moment' ||
            name.startsWith('@codemirror/') ||
            name.startsWith('@lezer/')
          )
        )
          return native(name);
        if (name in modules) return modules[name];
        throw new Error(`Unsupported module: ${name} (requires native desktop capabilities)`);
      };
      new Function(
        'module',
        'exports',
        'require',
        'app',
        '__dirname',
        '__filename',
        code + '\n//# sourceURL=plugin:' + id,
      )(module, module.exports, require, sharedApp, root, root + '/main.js');
      const Type = module.exports.default ?? module.exports;
      instance = new Type(sharedApp, manifest);
      if (!(instance instanceof Plugin)) throw new Error('Plugin must extend obsidian.Plugin');
      if (id === 'obsidian-plus') adaptNativePlusModules(instance);
      sharedApp.plugins.plugins[id] = instance;
      sharedApp.plugins.manifests[id] = manifest;
      await instance.load();
      loaded.set(id, instance);
      sharedApp.plugins.enabledPlugins.add(id);
      if (manifest.hasStyles) {
        const link = dom.createEl('link', {
          attr: {
            rel: 'stylesheet',
            href: `/api/plugins/${encodeURIComponent(id)}/styles.css`,
          },
        });
        document.head.append(link);
        instance.register(() => link.remove());
      }
      pluginStatuses.set(id, { id, state: 'loaded' });
      changed();
    } catch (error) {
      try {
        instance?.unload();
      } catch (cleanupError) {
        console.error(`[plugin:${id}:cleanup]`, cleanupError);
      }
      delete sharedApp.plugins.plugins[id];
      fail(id, error);
    }
  })().finally(() => pending.delete(id));
  pending.set(id, operation);
  return operation;
}
export function unloadPlugin(id: string) {
  const plugin = loaded.get(id);
  try {
    plugin?.unload();
  } finally {
    loaded.delete(id);
    delete sharedApp.plugins.plugins[id];
    sharedApp.plugins.enabledPlugins.delete(id);
    pluginStatuses.set(id, { id, state: 'disabled' });
    changed();
  }
}
export async function setPluginEnabled(id:string,enabled:boolean){
  if(nativePluginReplacements[id])throw new Error(nativePluginReplacements[id]+'，请使用原生设置');
  await api.setPluginEnabled(id, enabled);
  if (enabled) {
    const { plugins } = await api.listPlugins();
    const manifest = plugins.find((p) => p.id === id);
    if (manifest) await loadPlugin(id, manifest);
  } else {
    await pending.get(id);
    unloadPlugin(id);
  }
}
let initPromise: Promise<void> | undefined;
let stopHost: (() => void) | undefined;
export async function loadPlugins(): Promise<void> {
  if (initPromise) return initPromise;
  return (initPromise = (async () => {
    await useStore.getState().loadTree();
    sharedApp.vault.sync(useStore.getState().tree);
    const settings = await api.getSettings();
    sharedApp.vault.adapter.basePath = (window as any).webobsidianDesktop?.vaultPath ?? settings.vault.path;
    const stopMenus = bindPluginMenus(sharedApp);
    if ((window as any).webobsidianDesktop?.userscripts) {
      sharedApp.workspace.viewRegistry.set('webviewer', (leaf) => new WebViewerView(leaf));
      sharedApp.internalPlugins.plugins.webviewer = {
        enabled: true,
        instance: {
          open: (url: string) =>
            sharedApp.workspace.getLeaf(true).setViewState({ type: 'webviewer', state: { url } }),
        },
      };
      pluginCommands.set('webviewer:open', {
        id: 'webviewer:open',
        name: 'Open web viewer',
        callback: () => promptWebViewer(sharedApp),
      });
    }
    sharedApp.internalPlugins.plugins.templates = {
      enabled: true,
      instance: {
        options: { folder: '' },
        insertTemplate: async (file: files.TFile) => {
          const view = sharedApp.workspace.getActiveViewOfType(workspace.MarkdownView);
          if (view) view.editor.replaceSelection(await sharedApp.vault.cachedRead(file));
        },
      },
    };
    sharedApp.internalPlugins.plugins['command-palette'] = {
      enabled: true,
      instance: {
        open: () => useStore.getState().setPalette(true, 'commands'),
      },
    };
    sharedApp.internalPlugins.plugins.switcher = {
      enabled: true,
      instance: { open: () => useStore.getState().setPalette(true, 'files') },
    };
    const unsub = useStore.subscribe((state, prior) => {
      if (state.lastFileChange !== prior.lastFileChange && state.lastFileChange) {
        sharedApp.vault.applyFileStat(state.lastFileChange.path, state.lastFileChange.stat);
      } else if (state.tree !== prior.tree) sharedApp.vault.sync(state.tree, true);
      if (state.activePath !== prior.activePath) {
        sharedApp.workspace.trigger('file-open', sharedApp.workspace.getActiveFile());
        sharedApp.workspace.trigger('active-leaf-change', sharedApp.workspace.activeLeaf);
        sharedApp.workspace.trigger('layout-change');
      }
    });
    const pendingFiles = new Set<string>(),
      structuralFiles = new Set<string>();
    let metadataTimer: number | undefined,
      metadataRunning = false,
      metadataStopped = false;
    const drainMetadata = async () => {
      metadataTimer = undefined;
      if (metadataRunning || metadataStopped) return;
      metadataRunning = true;
      try {
        while (pendingFiles.size && !metadataStopped) {
          const paths = [...pendingFiles],
            structural = [...structuralFiles];
          pendingFiles.clear();
          structuralFiles.clear();
          await sharedApp.metadataCache.updateFiles(paths, structural);
        }
      } catch (error) {
        console.error('[metadata]', error);
      } finally {
        metadataRunning = false;
      }
    };
    const queueMetadata = (file: files.TAbstractFile, structural: boolean, oldPath?: string) => {
      if (!(file instanceof files.TFile)) return;
      if (!structural && !/^(md|markdown)$/i.test(file.extension)) return;
      pendingFiles.add(file.path);
      if (structural) structuralFiles.add(file.path);
      if (oldPath) {
        pendingFiles.add(oldPath);
        structuralFiles.add(oldPath);
      }
      if (metadataTimer === undefined && !metadataRunning)
        metadataTimer = window.setTimeout(() => {
          void drainMetadata();
        }, 0);
    };
    const metadataEvents = [
      sharedApp.vault.on('modify', (file: files.TFile) => queueMetadata(file, false)),
      sharedApp.vault.on('create', (file: files.TAbstractFile) => queueMetadata(file, true)),
      sharedApp.vault.on('delete', (file: files.TAbstractFile) => queueMetadata(file, true)),
      sharedApp.vault.on('rename', (file: files.TAbstractFile, oldPath: string) =>
        queueMetadata(file, true, oldPath),
      ),
    ];
    const keys = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      for (const command of pluginCommands.values())
        if (
          command.hotkeys?.some(
            (h) => h.key.toLowerCase() === event.key.toLowerCase() && ui.matchesModifiers(event, h.modifiers),
          ) &&
          runPluginCommand(command.id, true)
        ) {
          event.preventDefault();
          runPluginCommand(command.id);
          return;
        }
    };
    window.addEventListener('keydown', keys, true);
    stopHost = () => {
      stopMenus();
      unsub();
      metadataStopped = true;
      window.clearTimeout(metadataTimer);
      for (const ref of metadataEvents) sharedApp.vault.offref(ref);
      window.removeEventListener('keydown', keys, true);
      sharedApp.workspace.reset();
    };
    await sharedApp.metadataCache.initialize();
    Object.assign(window, { app: sharedApp, moment });
    sharedApp.workspace.markReady();
    const { plugins } = await api.listPlugins();
    for (const p of plugins) {
      sharedApp.plugins.manifests[p.id] = p;
      if (p.enabled) await loadPlugin(p.id, p);
      else pluginStatuses.set(p.id, { id: p.id, state: 'disabled' });
    }
    sharedApp.setting.pluginTabs = [...pluginTabs.values()];
    changed();
  })().catch((error) => {
    initPromise = undefined;
    console.error('[plugin host]', error);
  }));
}
export async function unloadPlugins() {
  await initPromise;
  await Promise.allSettled(pending.values());
  for (const id of loaded.keys()) {
    try {
      unloadPlugin(id);
    } catch (error) {
      fail(id, error);
    }
  }
  stopHost?.();
  stopHost = undefined;
  initPromise = undefined;
}
export function bindPluginEditor(view: cmView.EditorView, path: string) {
  const info = {
    get file() {
      return sharedApp.vault.getFileByPath(path);
    },
    editor: new editor.Editor(view),
    app: sharedApp,
  };
  const detach = editor.attachPluginEditor(view, info);
  view.dispatch({
    effects: cmState.StateEffect.appendConfig.of(
      cmView.EditorView.updateListener.of((update) => {
        if (update.docChanged) sharedApp.workspace.trigger('editor-change', info.editor, info);
      }),
    ),
  });
  return detach;
}
