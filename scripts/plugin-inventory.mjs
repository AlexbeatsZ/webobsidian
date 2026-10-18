import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

// Read-only: never executes plugin code or reads private plugin settings.
export async function inventory(vault) {
  const config = path.join(vault, '.obsidian');
  const enabled = JSON.parse(
    await fs.readFile(path.join(config, 'community-plugins.json'), 'utf8')
  );
  return Promise.all(
    enabled.map(async (id) => {
      const dir = path.join(config, 'plugins', id);
      try {
        const manifest = JSON.parse(
          await fs.readFile(path.join(dir, 'manifest.json'), 'utf8')
        );
        const code = await fs.readFile(path.join(dir, 'main.js'), 'utf8');
        const source = ts.createSourceFile(
          'main.js',
          code,
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.JS
        );
        const modules = new Set(),
          aliases = new Set(),
          exports = new Set();
        function visit(node) {
          if (
            ts.isCallExpression(node) &&
            node.expression.getText(source) === 'require' &&
            ts.isStringLiteral(node.arguments[0])
          ) {
            const name = node.arguments[0].text;
            modules.add(name);
            if (name === 'obsidian' && ts.isVariableDeclaration(node.parent)) {
              if (ts.isIdentifier(node.parent.name))
                aliases.add(node.parent.name.text);
              else
                for (const el of node.parent.name.elements)
                  exports.add(el.propertyName?.text ?? el.name.text);
            }
          }
          ts.forEachChild(node, visit);
        }
        visit(source);
        function properties(node) {
          if (
            ts.isPropertyAccessExpression(node) &&
            aliases.has(node.expression.getText(source))
          )
            exports.add(node.name.text);
          ts.forEachChild(node, properties);
        }
        properties(source);
        return {
          vault: path.basename(vault),
          id,
          version: manifest.version,
          desktop: !!manifest.isDesktopOnly,
          modules: [...modules].sort(),
          exports: [...exports].sort(),
        };
      } catch (error) {
        return { vault: path.basename(vault), id, error: error.message };
      }
    })
  );
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename)
) {
  for (const vault of process.argv.slice(2))
    console.log(JSON.stringify(await inventory(vault), null, 2));
}
