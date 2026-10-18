import { expect, it } from 'vitest';
import { buildShareScope } from './shareScope.js';

it('grants only declared embeds, their selected section and its own media', async () => {
  const files: Record<string, string> = {
    'root.md': '![[nested#Allowed]]\n[[secret]]\n`![[secret]]`\n%% ![[secret]] %%\n\n<div><img src="raw.png" onerror="bad()"></div>\n<script>![[secret]]</script>',
    'nested.md': '# Hidden\n![[private.png]]\n# Allowed\n![[ok.png]]\n![[root]]',
    'secret.md': 'secret',
  };
  const resolve = (target: string) => Object.hasOwn(files, target + '.md') ? target + '.md' : target.endsWith('.png') ? target : undefined;
  const scope = await buildShareScope('root.md', { read: async path => files[path], resolve });
  const root = scope.get('root')!;
  expect(root.notes.has('secret')).toBe(false);
  expect([...root.media.values()]).toEqual(['raw.png']);
  const nested = scope.get(root.notes.get('nested#Allowed')!)!;
  expect(nested.source).toBe('# Allowed\n![[ok.png]]\n![[root]]');
  expect([...nested.media.values()]).toEqual(['ok.png']);
  expect(nested.source).not.toContain('private');
  expect(scope.size).toBe(2);
});
