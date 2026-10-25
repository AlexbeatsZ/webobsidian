import { describe, expect, it } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AutomationSchema } from './contracts/automation';

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const groups = await Promise.all(entries.map(async entry => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(filename) : /\.tsx?$/.test(entry.name) && !entry.name.includes('.test.') ? [filename] : [];
  }));
  return groups.flat();
}

describe('browser-safe shared contracts', () => {
  it('keeps browser consumers independent of server service implementations', async () => {
    const directory = fileURLToPath(new URL('../../web/src/', import.meta.url));
    const violations: string[] = [];
    for (const filename of await sourceFiles(directory)) {
      if (/from\s+['"][^'"]*server\/src\/services\//.test(await readFile(filename, 'utf8'))) violations.push(filename);
    }
    expect(violations).toEqual([]);
  });

  it('retains automation defaults and strict validation in the shared schema', () => {
    expect(AutomationSchema.parse({})).toEqual({ version: 1, commands: [], templates: { folder: '', bindings: [], folderRules: [] } });
    expect(AutomationSchema.safeParse({ templates: { folder: '../outside' } }).success).toBe(false);
    expect(AutomationSchema.safeParse({ templates: { bindings: [{ id: 'template:demo', name: 'Demo', path: 'note.txt' }] } }).success).toBe(false);
    expect(AutomationSchema.safeParse({ commands: [
      { id: 'user:demo', name: 'Demo', code: '' }, { id: 'user:demo', name: 'Duplicate', code: '' },
    ] }).success).toBe(false);
    expect(AutomationSchema.safeParse({ unknown: true }).success).toBe(false);
  });
});
