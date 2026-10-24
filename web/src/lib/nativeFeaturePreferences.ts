import { request } from './api';
import type { CleanupOptions } from './attachments/types';
import type { TagPreferences } from '@webobsidian/markdown-core';

export interface NativeFeaturePreferences {
  vault: string; tags: TagPreferences; attachments: CleanupOptions;
}
let current: NativeFeaturePreferences | undefined;
let generation = 0;
export const tagPreferences = (): TagPreferences => current?.tags ?? { batchEnabled: false, wranglerEnabled: false };
export const haveNativeFeaturePreferences = () => current !== undefined;
export const importFolderTagNote = (vault: string) => request<{ content: string }>('/api/native-features/folder-tags/import?vault=' + encodeURIComponent(vault));
export function clearNativeFeaturePreferences() { current = undefined; generation++; }
export async function readNativeFeatures() {
  const started = generation;
  const value = await request<NativeFeaturePreferences>('/api/native-features');
  if (started !== generation) throw new Error('读取功能设置期间仓库已切换');
  current = value;
  return value;
}
export async function saveNativeFeatures(value: { vault: string; tags?: Partial<TagPreferences>; attachments?: CleanupOptions }) {
  const started = generation;
  const result = await request<NativeFeaturePreferences>('/api/native-features', { method: 'PUT', body: JSON.stringify(value) });
  if (started !== generation) throw new Error('保存功能设置期间仓库已切换');
  current = result;
  return result;
}
