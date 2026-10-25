import { applyEdits, modify } from 'jsonc-parser';
import { readObsidianConfiguration, writeObsidianPropertyTypes } from './vaultConfiguration.js';
import { broadcast } from './realtime.js';
import type { PropertyTypeExpectation } from '../contracts.js';
export type { PropertyTypeExpectation } from '../contracts.js';

/**
 * Obsidian stores per-vault property type assignments in `.obsidian/types.json`
 * ({ "types": { "<key>": "<type>" } } with types text|multitext|number|checkbox|
 * date|datetime|tags|aliases). We read/write the same file so WebObsidian's
 * property types interoperate with the Obsidian app.
 */

export async function readPropertyTypes() {
  const source = await readObsidianConfiguration('types.json');
  const data = source.exists ? JSON.parse(source.content.replace(/^\uFEFF/, '')) : {};
  if (!data || typeof data !== 'object' || Array.isArray(data) ||
      data.types !== undefined && (!data.types || typeof data.types !== 'object' || Array.isArray(data.types) ||
        Object.values(data.types).some(value => typeof value !== 'string')))
    throw Object.assign(new Error('属性类型配置无效，请修正 .obsidian/types.json'), { status: 400 });
  return { types: (data.types ?? {}) as Record<string, string>, source };
}

let changes: Promise<unknown> = Promise.resolve();
export function setPropertyType(key: string, type: string, expected: PropertyTypeExpectation) {
  const operation = changes.catch(() => {}).then(async () => {
    if (!key || key.length > 1024 || !['auto', 'text', 'multitext', 'number', 'checkbox', 'date', 'datetime', 'tags', 'aliases'].includes(type) ||
        !expected || typeof expected.vault !== 'string' || typeof expected.exists !== 'boolean' ||
        expected.previous !== null && typeof expected.previous !== 'string' || expected.exists && typeof expected.revision !== 'string')
      throw Object.assign(new Error('属性类型请求无效'), { status: 400 });
    const current = await readPropertyTypes();
    const previous = Object.hasOwn(current.types, key) ? current.types[key] : null;
    if (expected.vault !== current.source.vault ||
        (expected.revision !== current.source.revision || expected.exists !== current.source.exists) && previous !== expected.previous)
      throw Object.assign(new Error('该属性类型已被修改，请重新加载后重试'), { status: 409 });
    const bom = current.source.content.startsWith('\uFEFF') ? '\uFEFF' : '';
    const content = current.source.content.slice(bom.length) || '{}';
    const source = { ...current.source, content: bom + applyEdits(content,
      modify(content, ['types', key], type === 'auto' ? undefined : type,
        { formattingOptions: { insertSpaces: true, tabSize: 2, eol: content.includes('\r\n') ? '\r\n' : '\n' } })) };
    const saved = await writeObsidianPropertyTypes(source);
    broadcast({ type: 'vault-configuration-changed', path: '.obsidian/types.json', event: 'change' });
    return { types: (JSON.parse(saved.content.replace(/^\uFEFF/, '')).types ?? {}) as Record<string, string>, source: saved };
  });
  changes = operation;
  return operation;
}
