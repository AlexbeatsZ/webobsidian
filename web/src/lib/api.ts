import type { CatalogEntry } from '@webobsidian/search-core';
import { TEXT_EXT_RE } from './media';
import type { VaultConfigurationSource, PropertyTypeExpectation, TreeNode, SearchHit, MatchContext, NoteMatches } from '../../../server/src/contracts';
export type { VaultConfigurationSource, PropertyTypeExpectation, TreeNode, SearchHit, MatchContext, NoteMatches } from '../../../server/src/contracts';
// Thin fetch wrapper around the WebObsidian server API.

export interface TrashItem {
  name: string;
  path: string; // includes the .trash/ prefix
  original: string; // where it restores to
  ext: string;
  size: number;
  mtime: number;
}

export interface GitCommit {
  hash: string;
  date: string;
  message: string;
  author: string;
}

let mutations = 0;
let vaultSessionStale = false;
let vaultIdentity: string | undefined;
let identityRequest: Promise<string> | undefined;
export function invalidateVaultRequests() {
  vaultSessionStale = true;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('vault-identity-invalidated'));
}
export async function vaultRequestIdentity(): Promise<string> {
  if (vaultIdentity) return vaultIdentity;
  identityRequest ??= req<{ vault: string }>('/api/vault-identity').then(result => {
    if (vaultSessionStale) throw new ApiError('Vault 已切换，已忽略旧身份请求', 409);
    if (typeof result.vault !== 'string' || !result.vault) throw new ApiError('无效的 Vault 身份', 502);
    vaultIdentity = result.vault;
    return result.vault;
  }).finally(() => { identityRequest = undefined; });
  return identityRequest;
}
export const pendingMutations = () => mutations;
const mutationListeners = new Set<() => void>();
export function subscribeMutations(listener: () => void) {
  mutationListeners.add(listener);
  return () => { mutationListeners.delete(listener); };
}
const mutationChanged = () => { for (const listener of mutationListeners) listener(); };
let uiSettingsWrites: Promise<unknown> = Promise.resolve();

async function req<T>(url: string, opts: RequestInit & { vault?: string } = {}, trackMutation = true): Promise<T> {
  const scoped = url.startsWith('/api/') && url !== '/api/vault-identity';
  if (vaultSessionStale && scoped && !url.startsWith('/api/settings'))
    throw new ApiError('Vault 已切换，请重新加载应用；旧文档会话保留', 409);
  const expectedVault = scoped ? opts.vault ?? await vaultRequestIdentity() : undefined;
  if (vaultSessionStale && scoped && !url.startsWith('/api/settings')) {
    throw new ApiError('Vault 已切换，请重新加载应用；旧文档会话保留', 409);
  }
  // The settings switch owns the server maintenance lease. Counting its own
  // request as a document writer would prevent that lease from ever starting.
  let vaultSwitch = false;
  if (url.startsWith('/api/settings') && opts.method === 'PUT' && typeof opts.body === 'string') {
    try { vaultSwitch = typeof JSON.parse(opts.body)?.vault?.path === 'string'; } catch { /* Invalid JSON is rejected by the server. */ }
  }
  const mutation = trackMutation && !vaultSwitch && !['GET', 'HEAD', 'OPTIONS'].includes((opts.method ?? 'GET').toUpperCase()) &&
    url !== '/api/settings/debug' &&
    !['/api/attachments/execute', '/api/attachments/scan', '/api/tags/preview', '/api/search/matches'].includes(url.split('?')[0]);
  if (mutation) { mutations++; mutationChanged(); }
  try {
  const { headers: optHeaders, vault: _vault, ...rest } = opts;
  const headers = new Headers(optHeaders);
  if (!(opts.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (expectedVault) headers.set('X-Vault-Identity', expectedVault);
  const res = await fetch(url, {
    credentials: 'include',
    ...rest,
    // headers MUST be merged last — spreading ...opts after a `headers` literal
    // would drop Content-Type whenever a caller passes its own headers.
    headers,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const error = await res.json();
      msg = error.error ?? msg;
      if (error.code === 'VAULT_CHANGED') invalidateVaultRequests();
    } catch {
      /* ignore */
    }
    throw new ApiError(msg, res.status);
  }
  const ct = res.headers.get('content-type') ?? '';
  const result = await (ct.includes('application/json') ? res.json() : res.text()) as T;
  if (scoped && vaultSessionStale && !url.startsWith('/api/settings'))
    throw new ApiError('Vault 已切换，已忽略旧请求结果', 409);
  return result;
  } finally { if (mutation) { mutations--; mutationChanged(); } }
}

// Feature modules share the core request and error-handling path.
export { req as request };

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export const api = {
  // files
  tree: () => req<TreeNode>('/api/files/'),
  read: async (path: string, vault?: string) => {
    if (!TEXT_EXT_RE.test(path)) throw new ApiError('此文件不支持文本编辑，请以附件方式打开', 415);
    const expected = vault ?? await vaultRequestIdentity();
    const file = await req<{ path: string; content: string; revision?: string; vault: string }>(
      `/api/files/content?path=${encodeURIComponent(path)}`,
      { vault: expected },
    );
    if (!file || typeof file !== 'object' || typeof file.content !== 'string' || typeof file.vault !== 'string' || !file.vault)
      throw new ApiError('无效的文本文档响应，未创建文档会话', 502);
    if (file.vault !== expected) { invalidateVaultRequests(); throw new ApiError('文档来自其他 Vault，已保留当前会话', 409); }
    return file;
  },
  write: (path: string, content: string, baseRevision?: string, vault?: string) =>
    req<{ ok: true; revision?: string }>('/api/files/content', {
      method: 'PUT',
      body: JSON.stringify({ path, content, baseRevision }),
      vault,
    }),
  createFolder: (path: string) =>
    req<{ ok: true }>('/api/files/folder', { method: 'POST', body: JSON.stringify({ path }) }),
  createText: (path: string, content: string) => req<{ ok: true; revision: string }>('/api/files/content', {
    method: 'PUT', body: JSON.stringify({ path, content, createOnly: true }),
  }),
  rename: (from: string, to: string) =>
    req<{ ok: true }>('/api/files/rename', { method: 'PATCH', body: JSON.stringify({ from, to }) }),
  copy: (from: string, to: string) =>
    req<{ ok: true }>('/api/files/copy', { method: 'POST', body: JSON.stringify({ from, to }) }),
  remove: (path: string) =>
    req<{ ok: true; trashed?: string; deleted?: string }>(`/api/files/?path=${encodeURIComponent(path)}`, {
      method: 'DELETE',
    }),
  // trash (FR-1)
  listTrash: () => req<{ items: TrashItem[] }>('/api/files/trash'),
  restoreTrash: (path: string) =>
    req<{ ok: true; restored: string }>('/api/files/trash/restore', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),
  deleteTrashItem: (path: string) =>
    req<{ ok: true }>(`/api/files/trash/item?path=${encodeURIComponent(path)}`, { method: 'DELETE' }),
  emptyTrash: () => req<{ ok: true }>('/api/files/trash', { method: 'DELETE' }),
  uploadUrl: () => `/api/files/upload?vault=${encodeURIComponent(vaultIdentity ?? 'unbound')}`,
  upload: async (file: File, dir = 'attachments') => {
    const fd = new FormData();
    fd.append('dir', dir);
    fd.append('file', file);
    return req<{ ok: true; path: string; size: number }>('/api/files/upload', { method: 'POST', body: fd });
  },
  rawUrl: (path: string, sourcePath = '') =>
    `/api/files/content?path=${encodeURIComponent(path)}&sourcePath=${encodeURIComponent(sourcePath)}&vault=${encodeURIComponent(vaultIdentity ?? 'unbound')}`,

  catalog: () => req<{ entries: CatalogEntry[] }>('/api/catalog'),
  // search & links
  // limit omitted → server returns every match (panel renders them incrementally)
  search: (q: string, limit?: number, signal?: AbortSignal, mode: 'literal' | 'pinyin' = 'literal') =>
    req<{ hits: SearchHit[] }>(
      `/api/search?mode=${mode}&q=${encodeURIComponent(q)}${limit ? `&limit=${limit}` : ''}`,
      { signal },
    ),
  // per-note highlighted match contexts for the given paths (lazy, batched);
  // phrase=true matches the whole query as one needle (unlinked mentions)
  searchMatches: (
    query: string,
    paths: string[],
    matchCase = false,
    phrase = false,
    signal?: AbortSignal,
    mode: 'literal' | 'pinyin' = 'literal',
  ) =>
    req<{ matches: NoteMatches[] }>('/api/search/matches', {
      method: 'POST',
      body: JSON.stringify({ query, paths, matchCase, phrase, mode }),
      signal,
    }),
  tags: () => req<{ tags: { tag: string; count: number }[] }>('/api/tags'),
  properties: () => req<{ properties: { key: string; type: string; count: number }[] }>('/api/properties'),
  propertyTypes: () => req<{ types: Record<string, string>; source: VaultConfigurationSource }>('/api/property-types'),
  setPropertyType: (key: string, type: string, expected: PropertyTypeExpectation) =>
    req<{ types: Record<string, string>; source: VaultConfigurationSource }>('/api/property-types', {
      method: 'POST',
      body: JSON.stringify({ key, type, expected }),
    }),
  backlinks: (path: string, signal?: AbortSignal) =>
    req<{ backlinks: string[] }>(`/api/backlinks?path=${encodeURIComponent(path)}`, { signal }),
  resolve: (target: string, sourcePath = '') =>
    req<{
      path: string | null;
      status?: string;
      fragment?: string;
      candidates?: string[];
      normalizedTarget?: string;
      targetOccurrences?: { path: string; valid: boolean }[];
    }>(`/api/resolve?target=${encodeURIComponent(target)}&sourcePath=${encodeURIComponent(sourcePath)}`),
  contentTargets: (query = '', path?: string) => req<{ targets: { id: string; kind: string; label: string; path: string }[] }>(`/api/content-targets?query=${encodeURIComponent(query)}&limit=100${path === undefined ? '' : '&path=' + encodeURIComponent(path)}`),
  graph: () =>
    req<{
      nodes: { id: string; label: string; kind: 'note' | 'attachment' | 'unresolved'; tags: string[] }[];
      edges: { source: string; target: string }[];
    }>('/api/graph'),
  reindex: () => req<{ ok: true }>('/api/reindex', { method: 'POST' }),

  // ui state (workspace persistence, shared across browsers)
  getUiState: () => req<any>('/api/uistate/'),
  putUiState: (state: any, clientId: string) =>
    req<{ ok: true }>('/api/uistate/', {
      method: 'PUT',
      headers: { 'X-Client-Id': clientId },
      body: JSON.stringify(state),
    }),

  // settings
  getSettings: () => req<any>('/api/settings/'),
  appendDebug: (events: unknown[]) => req<{ ok: true }>('/api/settings/debug', { method: 'POST', body: JSON.stringify(events) }),
  readDebug: () => req<{ text: string }>('/api/settings/debug'),
  clearDebug: () => req<{ ok: true }>('/api/settings/debug', { method: 'DELETE' }),
  putSettings: (patch: any) => {
    const body = JSON.stringify(patch);
    const uiOnly = patch != null && Object.keys(patch).length === 1 && Object.hasOwn(patch, 'ui');
    const send = async () => {
      const settings = await req<any>('/api/settings/', { method: 'PUT', body }, !uiOnly);
      if (patch?.ui !== undefined && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('settings-changed', { detail: settings }));
      return settings;
    };
    if (!uiOnly) return send();
    mutations++; mutationChanged();
    const operation = uiSettingsWrites.catch(() => {}).then(send).finally(() => {
      mutations--; mutationChanged();
    });
    uiSettingsWrites = operation;
    return operation;
  },
  browse: (dir?: string) =>
    req<{ dir: string; parent: string; roots: string[]; folders: { name: string; path: string }[] }>(
      `/api/settings/browse${dir ? `?dir=${encodeURIComponent(dir)}` : ''}`,
    ),

  // git
  gitStatus: () => req<any>('/api/git/status'),
  gitInit: () => req<any>('/api/git/init', { method: 'POST' }),
  gitClone: () => req<any>('/api/git/clone', { method: 'POST' }),
  gitPull: () => req<{ message: string }>('/api/git/pull', { method: 'POST' }),
  gitCommit: (message?: string) =>
    req<{ message: string }>('/api/git/commit', { method: 'POST', body: JSON.stringify({ message }) }),
  gitPush: () => req<{ message: string }>('/api/git/push', { method: 'POST' }),
  gitSync: (message?: string) =>
    req<{ ok: boolean; log: string[] }>('/api/git/sync', {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),
  gitLog: (path: string) => req<{ commits: GitCommit[] }>(`/api/git/log?path=${encodeURIComponent(path)}`),
  gitShow: (hash: string, path: string) =>
    req<{ content: string }>(
      `/api/git/show?hash=${encodeURIComponent(hash)}&path=${encodeURIComponent(path)}`,
    ),

  // plugins
  listPlugins: () => req<{ plugins: any[] }>('/api/plugins/'),
  pluginData: (id: string) => req<{ data: any }>(`/api/plugins/${encodeURIComponent(id)}/data`),
  pluginRequest: (options: any) =>
    req<any>('/api/plugins/request', { method: 'POST', body: JSON.stringify(options) }),
  savePluginData: (id: string, data: unknown) =>
    req<{ ok: true }>(`/api/plugins/${encodeURIComponent(id)}/data`, {
      method: 'PUT',
      body: JSON.stringify({ data }),
    }),
  pluginAdapter: (op: string, path: string, body = {}) =>
    req<any>('/api/plugins/adapter', { method: 'POST', body: JSON.stringify({ op, path, ...body }) }),
  setPluginEnabled: (id: string, enabled: boolean) =>
    req<{ ok: true }>(`/api/plugins/${id}/enabled`, { method: 'PATCH', body: JSON.stringify({ enabled }) }),
};
