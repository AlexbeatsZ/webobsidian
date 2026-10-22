import { request } from './api';
import type { CleanupOptions } from './attachments/types';
import type { TagPreferences } from '../../../server/src/services/tags/types';

export interface NativeFeaturePreferences {
  vault: string; tags: TagPreferences; attachments: CleanupOptions;
}
let current: NativeFeaturePreferences | undefined;
let generation = 0;
export const tagPreferences = (): TagPreferences => current?.tags ?? { batchEnabled: false, wranglerEnabled: false };
export function clearNativeFeaturePreferences() { current = undefined; generation++; }
export async function readNativeFeatures() {
  const started = generation;
  const value = await request<NativeFeaturePreferences>('/api/native-features');
  if (started !== generation) throw new Error('Vault changed while reading feature settings');
  current = value;
  return value;
}
export async function saveNativeFeatures(value: { vault: string; tags?: Partial<TagPreferences>; attachments?: CleanupOptions }) {
  const started = generation;
  const result = await request<NativeFeaturePreferences>('/api/native-features', { method: 'PUT', body: JSON.stringify(value) });
  if (started !== generation) throw new Error('Vault changed while saving feature settings');
  current = result;
  return result;
}
