import { describe, expect, it } from 'vitest';
import { importLegacyFolderRules } from './importFolderRules';
const note = (object: string) => '```javascript\n// folder-tag-sync-config\n(' + object + ')\n```';
describe('legacy folder tag config data-only import', () => {
  it('clips inactive rules to managed roots and defaults auto-run off', () => {
    const result = importLegacyFolderRules(note('{managedRoots:["notes"],recursive:true,typeRules:[{folder:"notes",tags:["_笔记"]},{folder:"other",tags:["unused"]}],subjectRules:[{folder:"notes/chem",tags:["chem/organic"]}],}'));
    expect(result.enabled).toBe(false); expect(result.pruneAncestors).toBe(true);
    expect(result.rules.map(rule => rule.folder)).toEqual(['notes', 'notes/chem']);
  });
  it('rejects executable expressions, duplicate keys and unsupported schemas', () => {
    for (const code of ['{managedRoots:alert("x")}', '{managedRoots:["a"],managedRoots:["b"]}', '{managedRoots:["a"],extra:true}'])
      expect(() => importLegacyFolderRules(note(code))).toThrow();
  });
});
