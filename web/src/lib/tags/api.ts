import { request } from '../api';
import { useStore } from '../store';
import type { TagApplyResult, TagPreview, TagPreviewRequest, TagSummary, TagPreferences } from '@webobsidian/markdown-core';

export const tagsApi = {
  summary: (signal?: AbortSignal) => request<{ tags: TagSummary[]; preferences: TagPreferences }>('/api/tags', { signal }),
  preview: (body: TagPreviewRequest, signal?: AbortSignal) => {
    assertTagVaultCurrent();
    return request<TagPreview>('/api/tags/preview', { method: 'POST', body: JSON.stringify(body), signal });
  },
  apply: (id: string, path: string, confirmMerge: boolean, local = false) => {
    assertTagVaultCurrent();
    return request<TagApplyResult>('/api/tags/apply', { method: 'POST', body: JSON.stringify({ id, path, confirmMerge, local }) });
  },
  cancel: (id: string) => request<{ ok: boolean }>('/api/tags/cancel', { method: 'POST', body: JSON.stringify({ id }) }),
  page: (tag: string, signal?: AbortSignal) => request<{ pages: string[]; suggestedPath: string; content: string }>(
    '/api/tags/page?tag=' + encodeURIComponent(tag), { signal }),
  createPage: (tag: string, path: string) => {
    assertTagVaultCurrent();
    return request<{ path: string }>('/api/tags/page', { method: 'POST', body: JSON.stringify({ tag, path }) });
  },
};
export function assertTagVaultCurrent() {
  if (useStore.getState().vaultSessionStale)
    throw new Error('Vault 已切换，请重新加载应用；旧文档会话保留');
}
