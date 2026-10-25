import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { documentAppearance, UiSettingsSchema } from '../contracts/uiSettings';

const fixture = vi.hoisted(() => ({ directory: '' }));
vi.mock('../config.js', () => ({
  config: {
    get dataDir() { return fixture.directory; },
    get defaultVaultPath() { return path.join(fixture.directory, 'vault'); },
    allowedRoots: [],
  },
  get SETTINGS_FILE() { return path.join(fixture.directory, 'settings.json'); },
}));

let settings: typeof import('./settings');
let filename: string;

beforeEach(async () => {
  vi.resetModules();
  const temporary = path.join(os.tmpdir(), '.agents');
  await fs.mkdir(temporary, { recursive: true });
  fixture.directory = await fs.mkdtemp(path.join(temporary, 'appearance-settings-'));
  filename = path.join(fixture.directory, 'settings.json');
  settings = await import('./settings');
});

afterEach(async () => {
  vi.restoreAllMocks();
  const prefix = path.join(os.tmpdir(), '.agents', 'appearance-settings-');
  if (!path.resolve(fixture.directory).startsWith(prefix)) throw new Error('Unexpected settings test directory');
  await fs.rm(fixture.directory, { recursive: true, force: true });
});

describe('document appearance in existing UI settings', () => {
  it('loads older settings with compatible document defaults without rewriting the file', async () => {
    const initial = await settings.getSettings();
    const legacy = { ...initial, ui: { theme: 'obsidian-dark', defaultView: 'reading' } };
    const original = JSON.stringify(legacy);
    await fs.writeFile(filename, original);
    vi.resetModules();
    settings = await import('./settings');
    expect((await settings.getSettings()).ui).toMatchObject({ fontTextSize: 18, fileLineWidth: 700, theme: 'obsidian-dark', defaultView: 'reading' });
    expect(await fs.readFile(filename, 'utf8')).toBe(original);
  });

  it('uses inclusive integer boundaries and rejects invalid numbers and types', () => {
    for (const key of ['fontTextSize', 'fileLineWidth'] as const) {
      const limits = documentAppearance[key];
      for (const value of [limits.min, limits.max]) expect(UiSettingsSchema.safeParse({ [key]: value }).success).toBe(true);
      for (const value of [limits.min - 1, limits.max + 1, limits.default + 0.5, '', '24', null, NaN, Infinity]) {
        expect(UiSettingsSchema.safeParse({ [key]: value }).success, `${key}: ${String(value)}`).toBe(false);
      }
    }
    expect(UiSettingsSchema.partial().strict().parse({ fontTextSize: 24 })).toEqual({ fontTextSize: 24 });
  });

  it('persists partial edits through the existing queue and reloads without losing other preferences', async () => {
    await settings.getSettings();
    await Promise.all([
      settings.updateSettings(draft => { draft.ui.fontTextSize = 24; }),
      settings.updateSettings(draft => { draft.ui.fileLineWidth = 1100; draft.ui.theme = 'obsidian-dark'; }),
    ]);
    const persisted = JSON.parse(await fs.readFile(filename, 'utf8'));
    expect(persisted.ui).toMatchObject({ fontTextSize: 24, fileLineWidth: 1100, theme: 'obsidian-dark', defaultView: 'live' });
    vi.resetModules(); settings = await import('./settings');
    expect((await settings.loadSettings()).ui).toEqual(persisted.ui);
  });

  it('keeps cache and bytes after validation or disk failure and allows retry', async () => {
    const initial = await settings.getSettings(), original = await fs.readFile(filename, 'utf8');
    await expect(settings.updateSettings(draft => { draft.ui.fontTextSize = 100; })).rejects.toThrow();
    const rename = vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('disk busy'));
    await expect(settings.updateSettings(draft => { draft.ui.fileLineWidth = 900; })).rejects.toThrow('disk busy');
    expect((await settings.getSettings()).ui).toEqual(initial.ui);
    expect(await fs.readFile(filename, 'utf8')).toBe(original);
    expect((await fs.readdir(fixture.directory)).filter(name => name.includes('.tmp-'))).toEqual([]);
    rename.mockRestore();
    await settings.updateSettings(draft => { draft.ui.fileLineWidth = 900; });
    expect((await settings.getSettings()).ui.fileLineWidth).toBe(900);
  });
});
