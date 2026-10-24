import { api } from './api';

type Snapshot = Awaited<ReturnType<typeof api.propertyTypes>>;
let current: Snapshot | undefined;
let loading: Promise<void> | undefined;
let generation = 0, sequence = 0;
const empty = Object.freeze({}) as Record<string, string>;
const listeners = new Set<() => void>();
export const propertyTypesSnapshot = () => current?.types ?? empty;
export const subscribePropertyTypes = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
function publish(value: Snapshot | undefined) { current = value; for (const listener of listeners) listener(); }

async function reload() {
  const started = generation, request = ++sequence;
  const value = await api.propertyTypes();
  if (started === generation && request === sequence) publish(value);
}
export async function setPropertyType(key: string, type: string) {
  if (!current) await (loading ??= reload().finally(() => { loading = undefined; }));
  if (!current) throw new Error('属性类型尚未加载，请重试');
  const started = generation, request = ++sequence, { source, types } = current;
  try {
    const value = await api.setPropertyType(key, type, { vault: source.vault, revision: source.revision, exists: source.exists,
      previous: Object.hasOwn(types, key) ? types[key] : null });
    if (started !== generation) throw new Error('保存属性类型期间仓库已切换');
    if (request === sequence) publish(value);
    return value.types;
  } catch (error) {
    if (started === generation) await reload().catch(() => {});
    throw error;
  }
}

/** One Vault snapshot serves every editor, fragment and print context. */
export function initializePropertyTypes(report: (error: unknown) => void): () => void {
  const refresh = () => { void reload().catch(report); };
  const changed = (event: Event) => {
    if ((event as CustomEvent<{ path: string }>).detail?.path === '.obsidian/types.json') refresh();
  };
  const reset = () => { generation++; sequence++; loading = undefined; publish(undefined); };
  window.addEventListener('vault-configuration-changed', changed);
  window.addEventListener('vault-changed', reset);
  loading = reload().catch(report).finally(() => { loading = undefined; });
  return () => {
    window.removeEventListener('vault-configuration-changed', changed);
    window.removeEventListener('vault-changed', reset);
    reset();
  };
}
