import { findNodeAtLocation, parseTree } from 'jsonc-parser';
import { compileMenuConfig, MENU_CONFIG_DIRECTORY, MENU_CONFIG_MAX_BYTES, MENU_CONFIG_MAX_FILES, MENU_CONFIG_ROOT, menuDiagnostic, parseMenuConfig, resolveMenuInclude } from './config';
import { getMenuContext, snapshotMenuContext, transformMenu } from './transform';
import type { CompiledMenuConfig, ConfiguredMenuItem, MenuCommandHost, MenuConfig, MenuContext, MenuDiagnostic, MenuSource, MenuStorage } from './types';

export interface MenuConfigurationState {
  revision: number;
  loading: boolean;
  sources: readonly MenuSource[];
  diagnostics: readonly MenuDiagnostic[];
  lastValidAt?: number;
}

let controllerSequence = 0;
export class MenuConfigurationController {
  readonly sessionId = ++controllerSequence;
  private compiled: CompiledMenuConfig = compileMenuConfig([]);
  private compiledVault?: string;
  private generation = 0;
  private disposed = false;
  private listeners = new Set<() => void>();
  private state: MenuConfigurationState = { revision: 0, loading: false, sources: [], diagnostics: [] };
  constructor(readonly storage: MenuStorage, readonly host: MenuCommandHost) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<MenuConfigurationState>) {
    this.state = { ...this.state, ...patch, revision: this.state.revision + 1 };
    for (const listener of this.listeners) listener();
  }
  apply(items: readonly ConfiguredMenuItem[], context: MenuContext) {
    return transformMenu(items, this.compiled, snapshotMenuContext(context), {
      ...this.host,
      isContextCurrent: (captured) => !this.disposed && (this.host.isContextCurrent?.(captured) ?? true),
    });
  }
  async reload(): Promise<boolean> {
    if (this.disposed) return false;
    const generation = ++this.generation;
    this.publish({ loading: true });
    const sources = new Map<string, MenuSource>();
    const diagnostics: MenuDiagnostic[] = [];
    const configs: MenuConfig[] = [];
    const visiting = new Set<string>();
    const loaded = new Set<string>();
    const customIds = new Set<string>();
    let bytes = 0;
    let vault: string | undefined;
    const visit = async (file: string, importer?: MenuSource) => {
      if (this.disposed || generation !== this.generation) return;
      const key = file.toLowerCase();
      if (visiting.has(key)) { diagnostics.push(menuDiagnostic(importer?.path ?? file, importer?.content ?? '', `Circular include: ${file}`)); return; }
      if (loaded.has(key)) return;
      if (sources.size >= MENU_CONFIG_MAX_FILES) { diagnostics.push(menuDiagnostic(file, '', `At most ${MENU_CONFIG_MAX_FILES} menu files may be loaded`)); return; }
      visiting.add(key);
      let source: MenuSource;
      try {
        source = await this.storage.read(file, vault);
        if (this.disposed || generation !== this.generation) return;
        if (vault !== undefined && source.vault !== vault) throw new Error('重新加载菜单期间仓库已切换');
        vault = source.vault;
      } catch (e) {
        diagnostics.push(menuDiagnostic(file, '', String((e as Error).message ?? e)));
        visiting.delete(key);
        return;
      }
      sources.set(file, source);
      bytes += new TextEncoder().encode(source.content).length;
      if (bytes > MENU_CONFIG_MAX_BYTES) { diagnostics.push(menuDiagnostic(file, source.content, '菜单配置超过 1 MiB')); visiting.delete(key); return; }
      if (!source.exists) {
        if (file !== MENU_CONFIG_ROOT) diagnostics.push(menuDiagnostic(file, '', '包含的配置不存在'));
        visiting.delete(key); loaded.add(key); return;
      }
      const parsed = parseMenuConfig(file, source.content);
      diagnostics.push(...parsed.diagnostics);
      if (parsed.config) {
        for (const include of [...(parsed.config.includes ?? []), ...(parsed.config.imports ?? [])]) await visit(resolveMenuInclude(file, include), source);
        const tree = parseTree(source.content.replace(/^\uFEFF/, ' '));
        const ids = (items: NonNullable<MenuConfig['items']>, at: (string | number)[]) => items.forEach((item, i) => {
          if (customIds.has(item.id)) {
            const node = tree && findNodeAtLocation(tree, [...at, i, 'id']);
            diagnostics.push(menuDiagnostic(file, source.content, `Duplicate custom item ID: ${item.id}`, node?.offset ?? 0, node?.length ?? 1));
          }
          customIds.add(item.id);
          if (item.submenu) ids(item.submenu, [...at, i, 'submenu']);
        });
        ids(parsed.config.items ?? [], ['items']);
        configs.push(parsed.config);
      }
      visiting.delete(key);
      loaded.add(key);
    };
    await visit(MENU_CONFIG_ROOT);
    if (this.disposed || generation !== this.generation) return false;
    // Never let a last-valid configuration cross the current Vault boundary.
    if (this.compiledVault && vault && this.compiledVault !== vault) this.compiled = compileMenuConfig([]);
    if (!diagnostics.length) { this.compiled = compileMenuConfig(configs); this.compiledVault = vault; }
    this.publish({ loading: false, sources: [...sources.values()], diagnostics, ...(!diagnostics.length ? { lastValidAt: Date.now() } : {}) });
    return !diagnostics.length;
  }
  async save(source: MenuSource, content: string): Promise<boolean> {
    if (this.disposed) throw new Error('菜单会话已关闭');
    const currentVault = this.state.sources[0]?.vault;
    if (!currentVault || currentVault !== source.vault) throw new Error('仓库已切换，请重新打开菜单设置再保存');
    await this.storage.write(source.path, content, source);
    return this.reload();
  }
  exportSources(): string {
    return JSON.stringify({ version: 1, root: MENU_CONFIG_ROOT, directory: MENU_CONFIG_DIRECTORY,
      files: this.state.sources.filter((s) => s.exists).map(({ path, content }) => ({ path, content })) }, null, 2);
  }
  dispose() { this.disposed = true; this.generation++; this.listeners.clear(); this.compiled = compileMenuConfig([]); this.compiledVault = undefined; }
}

let current: MenuConfigurationController | undefined;
const listeners = new Set<() => void>();
let revision = 0;
const changed = () => { revision++; for (const listener of listeners) listener(); };
export const subscribeMenuConfiguration = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const getMenuConfigurationRevision = () => revision;
export const getMenuConfigurationController = () => current;

export function initializeConfiguredMenus(storage: MenuStorage, host: MenuCommandHost): () => void {
  current?.dispose();
  const controller = new MenuConfigurationController(storage, host);
  current = controller;
  const unsubscribe = controller.subscribe(changed);
  changed();
  void controller.reload().then((ok) => { if (!ok && current === controller) host.notify('右键菜单配置加载失败；保留本 Vault 上一个有效配置。请查看设置中的错误位置。'); }).catch((e) => { if (current === controller) host.notify(String(e)); });
  return () => {
    unsubscribe(); controller.dispose();
    if (current === controller) { current = undefined; changed(); }
  };
}

export function applyConfiguredMenu(items: readonly ConfiguredMenuItem[], context?: MenuContext): ConfiguredMenuItem[] {
  const effective = context ?? getMenuContext(items) ?? { kind: 'generic' };
  return current ? current.apply(items, effective) : transformMenu(items, compileMenuConfig([]), snapshotMenuContext(effective));
}

let pendingFileChange = false;
export function notifyMenuConfigurationFileChanged(path: string): void {
  if (!path.replace(/\\/g, '/').startsWith(MENU_CONFIG_DIRECTORY) || pendingFileChange || !current) return;
  const controller = current;
  pendingFileChange = true;
  queueMicrotask(() => {
    pendingFileChange = false;
    if (current === controller) void controller.reload().catch((e) => { if (current === controller) controller.host.notify(String(e)); });
  });
}
