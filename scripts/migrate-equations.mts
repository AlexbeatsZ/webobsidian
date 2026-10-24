/** Offline, explicit migration. Imports current source, never stale dist or plugin code. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { createTwoFilesPatch } from 'diff';
import {
  SourceDocument, analyzeMarkdown, equations, equationAnchor, equationContext,
  equationTarget, extractMetadata, mathRegions, markdownComments, isEscaped,
  TargetIndex, parseLinkTarget, mathBodyOffset, tableModels,
  type Equation, type SourceChange, type SourceSpan,
} from '../packages/markdown-core/src/index.ts';

type Issue = { file: string; line: number; reason: string; source: string };
type Options = { files?: string[]; keepTags?: boolean; dropNumberAliases?: boolean };
type Entry = { file: string; before: string; after: string; changes: SourceChange[] };
const normalize = (s: string) => s.normalize('NFC').replace(/[\u2010-\u2014\u2212]/g, '-').replace(/\s+/g, '');
const numeric = (s: string) => /^\d+(?:[-.]\d+)*$/.test(normalize(s));
const overlaps = (a: SourceSpan, b: SourceSpan) => a.from < b.to && a.to > b.from;
const decode = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };

/** Plan against one immutable vault snapshot, including inbound links to selected files. */
export function planMigration(input: Map<string, string>, options: Options = {}) {
  const selected = new Set(options.files?.length ? options.files : input.keys());
  for (const file of selected) if (!input.has(file)) throw new Error(`File not found in vault: ${file}`);
  const index = new TargetIndex(input.keys());
  const notes = new Map([...input].map(([file, raw]) => {
    const doc = new SourceDocument(raw), model = analyzeMarkdown(doc.text, file);
    return [file, { doc, model, formulas: equations(model), changes: [] as SourceChange[],
      anchors: new Map<Equation, string>(), blocked: new Set<Equation>() }] as const;
  }));
  const issues: Issue[] = [], references: { file: string; line: number; before: string; after: string; target: string }[] = [];
  const numbered: { file: string; id: string; old: string | null; current: string | null }[] = [];
  let anchorsAdded = 0, tagsRemoved = 0;
  const issue = (file: string, range: SourceSpan, reason: string) => {
    const text = notes.get(file)!.model.text;
    issues.push({ file, line: text.slice(0, range.from).split('\n').length, reason, source: text.slice(range.from, range.to) });
  };
  for (const file of selected) {
    const note = notes.get(file)!;
    // Each anchor is allocated against the same model. Reserve all allocated IDs too.
    const used = new Set(extractMetadata(note.model).blockIds.map(b => b.id));
    for (const [ordinal, eq] of note.formulas.entries()) {
      // Untagged formulas already use native numbering; migrate legacy targets only.
      if (eq.tag === undefined) continue;
      if (eq.ambiguous || !eq.referenceable) {
        note.blocked.add(eq);
        issue(file, eq, eq.ambiguous ? 'Duplicate block ID' : 'Formula needs its own closing line (or is inside a table)');
        continue;
      }
      const prepared = equationAnchor(note.model, eq.from, `migrated${ordinal + 1}`);
      let id = prepared.id;
      if (prepared.change) {
        const base = id; let suffix = 1;
        while (used.has(id)) id = `${base}-${suffix++}`;
        note.changes.push({ ...prepared.change, insert: ` ^${id}` });
        anchorsAdded++;
      }
      used.add(id); note.anchors.set(eq, id);
    }
  }
  function lookup(file: string, fragment: string, sourceFile: string, range: SourceSpan) {
    const note = notes.get(file)!;
    const eq = equationTarget(equationContext(note.model), fragment);
    if (!eq || eq.ambiguous || !note.anchors.has(eq)) {
      // Keep tags needed by an unresolved/ambiguous old reference.
      const label = decode(fragment).match(/^=\((.+)\)(?:§\d+)?$/)?.[1];
      for (const candidate of note.formulas) if (label && candidate.tag && normalize(candidate.tag) === normalize(label)) note.blocked.add(candidate);
      issue(sourceFile, range, `Unresolved or ambiguous formula target: ${file}#${fragment}`);
      return;
    }
    return { eq, id: note.anchors.get(eq)! };
  }
  function record(file: string, range: SourceSpan, insert: string, target: string) {
    const note = notes.get(file)!;
    note.changes.push({ ...range, insert });
    references.push({ file, line: note.model.text.slice(0, range.from).split('\n').length,
      before: note.model.text.slice(range.from, range.to), after: insert, target });
  }
  for (const [file, note] of notes) {
    const { model } = note, text = model.text, math = mathRegions(model);
    const excluded = [...model.literal, ...model.html, ...model.htmlBlocks, ...markdownComments(model), ...(model.frontmatter ? [model.frontmatter] : [])];
    const inside = (range: SourceSpan) => excluded.some(r => overlaps(r, range));
    const linkRanges: SourceSpan[] = [];
    // Wiki syntax is the same source convention used by the native metadata reader.
    for (const match of text.matchAll(/!?\[\[([^\]\n]+?)\]\]/g)) {
      const span = { from: match.index!, to: match.index! + match[0].length };
      if (inside(span) || isEscaped(text, span.from) || math.some(r => r.from <= span.from && overlaps(r, span))) continue;
      linkRanges.push(span);
      const tableAlias = tableModels(model).some(t => span.from >= t.from && span.to <= t.to) ? match[0].indexOf('\\|') : -1;
      const target = parseLinkTarget(tableAlias < 0 ? match[1] : match[1].replace(/\\\|/g, '|'));
      if (!/^=\(.+\)(?:§[1-9]\d*)?$/.test(decode(target.fragment))) continue;
      const resolved = index.resolve(`${target.path}#${target.fragment}`, file);
      if (resolved.status !== 'resolved') {
        if (selected.has(file)) issue(file, span, `Target note ${resolved.status}: ${target.path}`);
        continue;
      }
      if (!selected.has(resolved.path)) {
        if (selected.has(file)) issue(file, span, `Target outside --file selection: ${resolved.path}`);
        continue;
      }
      const found = lookup(resolved.path, target.fragment, file, span); if (!found) continue;
      // Patch the destination, preserving !, path spelling, whitespace and custom aliases.
      const hash = match[0].indexOf('#'), plainAlias = match[0].search(/(?<!\\)\|/);
      const alias = tableAlias < 0 ? plainAlias : plainAlias < 0 ? tableAlias : Math.min(tableAlias, plainAlias);
      const end = alias < 0 ? match[0].length - 2 : alias;
      const trailing = match[0].slice(hash + 1, end).match(/\s*$/)![0];
      let tail = match[0].slice(end);
      if (options.dropNumberAliases && alias >= 0) {
        const value = target.alias!.trim().replace(/^\$?\\text\{(.*)\}\$?$/, '$1');
        if (normalize(value) === `(${normalize(found.eq.tag ?? '')})`) tail = ']]';
      }
      record(file, span, `${match[0].slice(0, hash + 1)}^${found.id}${trailing}${tail}`, `${resolved.path}#^${found.id}`);
    }
    // URL ranges come from Lezer, including balanced parentheses and reference definitions.
    // Preserve Markdown labels/titles; only replace the legacy fragment in the URL.
    for (const url of model.nodes.filter(n => n.name === 'URL')) {
      if (inside(url) || math.some(r => overlaps(r, url)) || linkRanges.some(r => overlaps(r, url))) continue;
      const raw = text.slice(url.from, url.to), target = parseLinkTarget(raw);
      if (!/^=\(.+\)(?:§[1-9]\d*)?$/.test(decode(target.fragment))) continue;
      const resolved = index.resolve(raw, file);
      if (resolved.status !== 'resolved' || !selected.has(resolved.path)) {
        if (selected.has(file)) issue(file, url, `Markdown target ${resolved.status === 'resolved' ? 'outside --file selection' : resolved.status}: ${raw}`);
        continue;
      }
      const found = lookup(resolved.path, target.fragment, file, url); if (!found) continue;
      record(file, url, `${raw.slice(0, raw.indexOf('#') + 1)}^${found.id}`, `${resolved.path}#^${found.id}`);
    }
    if (!selected.has(file)) continue;
    for (const ref of math) {
      if (!ref.closed || ref.display || ref.kind !== 'dollar' || inside(ref) || linkRanges.some(r => overlaps(r, ref)) ||
        model.nodes.some(n => ['Link', 'Image', 'LinkReference'].includes(n.name) && overlaps(n, ref))) continue;
      const match = ref.tex.match(/^\s*\\text\s*\{\s*\(\s*([\d.\s\u2010-\u2014\u2212-]+)\s*\)\s*\}\s*$/);
      if (!match || !numeric(match[1])) continue;
      const found = lookup(file, `=(${normalize(match[1])})`, file, ref); if (!found) continue;
      record(file, ref, `[[#^${found.id}]]`, `${file}#^${found.id}`);
    }
  }
  for (const file of selected) {
    const note = notes.get(file)!;
    if (!options.keepTags) for (const eq of note.formulas) {
      if (!eq.tag || !numeric(eq.tag) || !note.anchors.has(eq) || note.blocked.has(eq) || /\{\{\}\}\s*$|\\(?:notag|nonumber)\b/.test(eq.tex)) continue;
      // Only a flat numeric tag is removed, within parser-owned TeX source segments.
      // Custom tags and TeX/macros/comments are retained, rather than broadly stripping TeX.
      const matches = eq.segments.flatMap(segment => [...note.model.text.slice(segment.from, segment.to).matchAll(/\\tag\*?\s*\{[\d.\s\u2010-\u2014\u2212-]+\}/g)]
        .filter(m => {
          const from = segment.from + m.index!;
          const line = note.model.text.slice(note.model.text.lastIndexOf('\n', from - 1) + 1, from);
          if (isEscaped(note.model.text, from) || [...line.matchAll(/%/g)].some(p => !isEscaped(line, p.index!))) return false;
          // A command inside a macro argument/definition is not a display tag.
          const prefix = eq.tex.slice(0, mathBodyOffset(eq, from)); let depth = 0;
          for (let i = 0; i < prefix.length; i++) {
            if (isEscaped(prefix, i)) continue;
            if (prefix[i] === '%') { const end = prefix.indexOf('\n', i); i = end < 0 ? prefix.length : end; }
            else if (prefix[i] === '{') depth++;
            else if (prefix[i] === '}') depth--;
          }
          return depth === 0;
        })
        .map(m => ({ from: segment.from + m.index!, to: segment.from + m.index! + m[0].length, insert: '' })));
      if (matches.length !== 1) { issue(file, eq, 'Numeric tag cannot be removed safely'); continue; }
      note.changes.push(matches[0]); tagsRemoved++;
    }
  }
  const entries: Entry[] = [];
  for (const [file, note] of notes) {
    const before = note.doc.raw;
    note.doc.apply(note.changes);
    if (before !== note.doc.raw) entries.push({ file, before, after: note.doc.raw, changes: note.changes });
    if (selected.has(file)) {
      const after = equations(analyzeMarkdown(note.doc.text, file));
      // Source patches must not change equation membership or target identity.
      if (after.length !== note.formulas.length) throw new Error(`Formula count changed in ${file}`);
      note.formulas.forEach((eq, i) => {
        const id = note.anchors.get(eq);
        if (id) {
          if (after[i].id !== id || after[i].ambiguous) throw new Error(`Anchor verification failed in ${file}: ${id}`);
          numbered.push({ file, id, old: eq.number, current: after[i].number });
        }
      });
    }
  }
  const tagged = [...selected].reduce((count, file) => count + notes.get(file)!.formulas.filter(eq => eq.tag !== undefined).length, 0);
  return { entries, issues, references, numbered, summary: { scanned: input.size, selected: selected.size,
    changedFiles: entries.length, anchorsAdded, tagsRemoved, tagsRetained: tagged - tagsRemoved,
    referencesConverted: references.length, unresolved: issues.length } };
}

function within(root: string, target: string) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
async function canonicalDestination(target: string): Promise<string> {
  try { return await fs.realpath(target); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    if (path.dirname(target) === target) throw error;
    return path.join(await canonicalDestination(path.dirname(target)), path.basename(target));
  }
}
async function safeFile(root: string, relative: string) {
  if (!relative || path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').some(p => !p || p === '.' || p === '..')) throw new Error(`Unsafe relative path: ${relative}`);
  const file = path.resolve(root, relative);
  if (!within(root, file) || !within(root, await fs.realpath(file)) || (await fs.lstat(file)).isSymbolicLink()) throw new Error(`File escapes root or is a symlink: ${file}`);
  return file;
}
async function readVault(root: string) {
  const result = new Map<string, string>();
  async function walk(dir: string) {
    for (const entry of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      if (entry.isSymbolicLink()) throw new Error(`Symlinks are not supported: ${path.join(dir, entry.name)}`);
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (/\.(?:md|markdown)$/i.test(entry.name)) {
        const raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await fs.readFile(file));
        result.set(path.relative(root, file).split(path.sep).join('/'), raw);
      }
    }
  }
  await walk(root); return result;
}
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
async function preview(out: string, vault: string, plan: ReturnType<typeof planMigration>, options: Options) {
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.mkdir(out); // Never overwrite an earlier preview/backup.
  let diff = '';
  for (const entry of plan.entries) {
    for (const [folder, raw] of [['before', entry.before], ['after', entry.after]]) {
      const destination = path.join(out, folder, entry.file);
      await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.writeFile(destination, raw, 'utf8');
    }
    diff += createTwoFilesPatch(`before/${entry.file}`, `after/${entry.file}`, entry.before, entry.after);
  }
  const report = { version: 1, vault, createdAt: new Date().toISOString(), options, ...plan,
    entries: plan.entries.map(({ file }) => ({ file })), state: 'preview' };
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  await fs.writeFile(path.join(out, 'changes.diff'), diff);
  const rows = plan.numbered.map(e => `<tr><td>${escape(e.file)}</td><td>${escape(e.id)}</td><td>${escape(e.old ?? '—')}</td><td>${escape(e.current ?? '—')}</td></tr>`).join('');
  const refs = plan.references.map(r => `<tr><td>${escape(r.file)}:${r.line}</td><td><code>${escape(r.before)}</code></td><td><code>${escape(r.after)}</code></td></tr>`).join('');
  const issues = plan.issues.map(i => `<li>${escape(i.file)}:${i.line} — ${escape(i.reason)}<pre>${escape(i.source)}</pre></li>`).join('');
  await fs.writeFile(path.join(out, 'preview.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>公式引用迁移预览</title><style>body{font:16px/1.65 system-ui;max-width:1280px;margin:40px auto;padding:0 28px;color:#24303b;background:#faf9f5}h1{font-size:30px}table{border-collapse:collapse;width:100%;background:white;margin:20px 0}td,th{border:1px solid #ddd;padding:10px;text-align:left;overflow-wrap:anywhere}code,pre{font:14px/1.6 Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere}summary{cursor:pointer;padding:12px;background:#e9edf0}.stats{padding:18px;background:#e0eee6}</style><h1>公式引用迁移预览</h1><p>这是源文件的迁移对照。公式的实际渲染由 WebObsidian 完成。原文和结果分别在 before / after 中；此页面不加载任何外部资源。</p><pre class="stats">${escape(JSON.stringify(plan.summary, null, 2))}</pre><h2>需要处理的问题</h2>${issues ? `<ul>${issues}</ul>` : '<p>未发现无法定位的引用。</p>'}<h2>正文和链接迁移</h2><table><tr><th>位置</th><th>迁移前</th><th>迁移后</th></tr>${refs}</table><details><summary>公式锚点与编号对照 (${plan.numbered.length})</summary><table><tr><th>文档</th><th>固定锚点</th><th>旧编号</th><th>当前自动编号</th></tr>${rows}</table></details><details><summary>完整差异</summary><pre>${escape(diff)}</pre></details></html>`);
  return report;
}
async function atomicWrite(file: string, content: Buffer) {
  const temporary = `${file}.equation-migration-${process.pid}.tmp`;
  let created = false;
  try {
    await fs.writeFile(temporary, content, { flag: 'wx', mode: (await fs.stat(file)).mode });
    created = true;
    await fs.rename(temporary, file);
  } finally { if (created) await fs.rm(temporary, { force: true }); }
}
async function assertSnapshot(root: string, input: Map<string, string>) {
  const current = await readVault(root);
  if (current.size !== input.size || [...input].some(([file, raw]) => current.get(file) !== raw)) throw new Error('Vault changed during migration; generate a fresh preview');
}
export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    vault: { type: 'string' }, file: { type: 'string', multiple: true }, out: { type: 'string' },
    apply: { type: 'boolean' }, restore: { type: 'string' }, 'keep-tags': { type: 'boolean' },
    'drop-number-aliases': { type: 'boolean' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('node --import tsx scripts/migrate-equations.mts --vault <vault> --out <new-preview-dir> [--file <relative.md>] [--keep-tags] [--drop-number-aliases] [--apply]\nnode --import tsx scripts/migrate-equations.mts --restore <preview-dir>\nDefault: preview only. --file also updates inbound references elsewhere in the vault. --apply requires zero unresolved issues. Close editors before applying/restoring.');
    return;
  }
  if (values.restore) {
    if (args.length !== 2) throw new Error('--restore cannot be combined with other options');
    const out = await fs.realpath(values.restore);
    const report = JSON.parse(await fs.readFile(path.join(out, 'report.json'), 'utf8'));
    if (report.version !== 1 || !['applied', 'applying', 'apply-failed', 'restoring', 'restore-failed', 'restored'].includes(report.state)) throw new Error('This report has no applied migration to restore');
    const vault = await fs.realpath(report.vault);
    const pending: { file: string; before: Buffer; after: Buffer }[] = [];
    for (const entry of report.entries) {
      const file = await safeFile(vault, entry.file), before = await fs.readFile(await safeFile(path.join(out, 'before'), entry.file));
      const after = await fs.readFile(await safeFile(path.join(out, 'after'), entry.file)), current = await fs.readFile(file);
      if (current.equals(before)) continue;
      if (!current.equals(after)) throw new Error(`Restore refused: edited since migration: ${entry.file}`);
      pending.push({ file, before, after });
    }
    report.state = 'restoring'; await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    try {
      for (const entry of pending) {
        if (!(await fs.readFile(entry.file)).equals(entry.after)) throw new Error(`Changed during restore: ${entry.file}`);
        await atomicWrite(entry.file, entry.before);
      }
      report.state = 'restored';
    } catch (error) { report.state = 'restore-failed'; throw error; }
    finally { await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); }
    console.log(`Restored ${pending.length} files. ${out}`); return;
  }
  if (!values.vault || !values.out) throw new Error('--vault and --out are required; use --help');
  const vault = await fs.realpath(values.vault), out = await canonicalDestination(path.resolve(values.out));
  if (within(vault, out)) throw new Error('--out must be outside the source vault');
  const input = await readVault(vault), options = { files: values.file?.map(f => f.replace(/\\/g, '/')), keepTags: values['keep-tags'], dropNumberAliases: values['drop-number-aliases'] };
  const plan = planMigration(input, options), report = await preview(out, vault, plan, options);
  console.log(JSON.stringify(plan.summary, null, 2)); console.log(`Preview: ${path.join(out, 'preview.html')}`);
  if (values.apply) {
    if (plan.issues.length) throw new Error(`Apply refused: ${plan.issues.length} unresolved issues; see report.json. Source vault unchanged.`);
    await assertSnapshot(vault, input);
    report.state = 'applying'; await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    try {
      for (const entry of plan.entries) {
        const file = await safeFile(vault, entry.file);
        if (!(await fs.readFile(file)).equals(Buffer.from(entry.before))) throw new Error(`Changed during apply: ${entry.file}`);
        await atomicWrite(file, Buffer.from(entry.after));
      }
      report.state = 'applied';
    } catch (error) { report.state = 'apply-failed'; throw error; }
    finally { await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); }
    console.log('Applied. Originals saved in before/; use --restore to undo.');
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(String(error)); process.exitCode = 1; });
}
