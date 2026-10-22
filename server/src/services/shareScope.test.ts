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

it('projects original equation numbers without exposing preceding source or heading labels', async () => {
  const files: Record<string, string> = {
    'root.md': '![[note#^eq-allowed]]\n[[private#^eq-secret]]',
    'note.md': '# Secret chapter title\n$$privateFormula$$\n# Allowed chapter\n$$x$$ ^eq-allowed\n\n$$laterSecret$$',
    'private.md': '$$privateTarget$$ ^eq-secret',
  };
  const scope = await buildShareScope('root.md', {
    read: async path => files[path], resolve: target => files[target + '.md'] ? target + '.md' : undefined,
  });
  const root = scope.get('root')!, nested = scope.get(root.notes.get('note#^eq-allowed')!)!;
  expect(nested.equations?.equations.map(e => [e.id, e.number, e.heading])).toEqual([['eq-allowed', '2-1', '']]);
  expect(nested.source).toBe('$$x$$ ^eq-allowed');
  expect(JSON.stringify([...scope.values()])).not.toContain('privateFormula');
  expect(JSON.stringify([...scope.values()])).not.toContain('Secret chapter title');
  expect(JSON.stringify([...scope.values()])).not.toContain('laterSecret');
  expect(root.notes.has('private#^eq-secret')).toBe(false);
});
