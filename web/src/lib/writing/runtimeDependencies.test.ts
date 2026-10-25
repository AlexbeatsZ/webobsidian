import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve('web/src');
function runtimeGraph() {
  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(filename);
      else if (/\.tsx?$/.test(filename) && !/\.(?:test|d)\.ts$/.test(filename)) files.push(filename);
    }
  };
  visit(root);
  const known = new Set(files);
  const graph = new Map<string, string[]>();
  for (const filename of files) {
    const output = ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.Preserve },
    }).outputText;
    const source = ts.createSourceFile(filename, output, ts.ScriptTarget.ESNext, true);
    const edges: string[] = [];
    for (const statement of source.statements) {
      if ((!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) ||
        !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const specifier = statement.moduleSpecifier.text;
      if (!specifier.startsWith('.')) continue;
      const base = path.resolve(path.dirname(filename), specifier);
      const target = [base, base + '.ts', base + '.tsx', path.join(base, 'index.ts'), path.join(base, 'index.tsx')]
        .find(candidate => known.has(candidate) && existsSync(candidate));
      if (target) edges.push(target);
    }
    graph.set(filename, edges);
  }
  return graph;
}

function cycles(graph: Map<string, string[]>) {
  let nextIndex = 0;
  const indices = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const stacked = new Set<string>();
  const groups: string[][] = [];
  const visit = (filename: string) => {
    indices.set(filename, nextIndex);
    low.set(filename, nextIndex++);
    stack.push(filename);
    stacked.add(filename);
    for (const target of graph.get(filename) ?? []) {
      if (!indices.has(target)) {
        visit(target);
        low.set(filename, Math.min(low.get(filename)!, low.get(target)!));
      } else if (stacked.has(target)) low.set(filename, Math.min(low.get(filename)!, indices.get(target)!));
    }
    if (low.get(filename) !== indices.get(filename)) return;
    const group: string[] = [];
    let member: string;
    do {
      member = stack.pop()!;
      stacked.delete(member);
      group.push(path.relative(root, member).replaceAll('\\', '/'));
    } while (member !== filename);
    if (group.length > 1 || graph.get(filename)?.includes(filename)) groups.push(group.sort());
  };
  for (const filename of graph.keys()) if (!indices.has(filename)) visit(filename);
  return groups.sort((first, second) => first[0].localeCompare(second[0]));
}

describe('native writing runtime dependency ownership', () => {
  it('keeps configuration and editor routing outside runtime import cycles', () => {
    const groups = cycles(runtimeGraph());
    console.info('Runtime static import SCCs:', JSON.stringify(groups));
    expect(groups.filter(group => group.some(filename =>
      filename === 'lib/activeEditor.ts' || filename === 'lib/editorCommands.ts' ||
      filename === 'lib/fragmentNavigation.ts' || filename === 'lib/writing/latex/settings/settings.ts' ||
      filename === 'lib/writing/latex/editor_extensions/concealMacros.ts' ||
      filename === 'lib/writing/latex/editor_context/context.ts' ||
      filename === 'lib/writing/latex/editor_context/mathbounds.ts' ||
      filename === 'lib/writing/latex/editor_context/mathPresentation.ts' ||
      filename === 'lib/writing/latex/snippets/codemirror/config.ts'))).toEqual([]);
  });
});
