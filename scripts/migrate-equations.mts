/** Offline, explicit migration. Imports current source, never stale dist or plugin code. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { createTwoFilesPatch } from 'diff';
import {
  SourceDocument, analyzeMarkdown, equations, equationAnchor, equationReferenceName,
  extractMetadata, mathRegions, markdownComments, isEscaped,
  TargetIndex, parseLinkTarget, mathBodyOffset, tableModels,
  contentTargets, createContentTarget, fragmentRange, isGlobalContentTarget,
  type Equation, type SourceChange, type SourceSpan, type Heading,
} from '../packages/markdown-core/src/index.ts';
import { legacySubheadings, legacySubheadingRange } from '../packages/markdown-core/src/migration.ts';

type Issue = { file: string; line: number; reason: string; source: string };
type Repair = { file: string; source: string; insert: string; reason: string };
type Resolution = { file: string; source: string; occurrence?: number; targetFile: string; targetText: string; targetKind?: 'callout' | 'range'; reason: string };
type Review = { repairs?: Repair[]; resolutions?: Resolution[]; paths?: { sourcePath: string; targetFile: string; reason: string }[] };
type Options = { files?: string[]; keepTags?: boolean; dropNumberAliases?: boolean; globalReferences?: boolean; review?: Review };
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
  const reviewedPaths = new Map<string, string>();
  for (const entry of options.review?.paths ?? []) {
    if (!entry.sourcePath || !entry.reason || !input.has(entry.targetFile) || reviewedPaths.has(entry.sourcePath)) throw new Error(`Invalid reviewed path: ${entry.sourcePath}`);
    reviewedPaths.set(entry.sourcePath, entry.targetFile);
  }
  const resolve = (raw: string, sourceFile: string) => {
    const target = parseLinkTarget(raw), reviewed = reviewedPaths.get(target.path);
    return reviewed ? { status: 'resolved' as const, path: reviewed } : index.resolve(raw, sourceFile);
  };
  const repairs: Repair[] = [];
  const notes = new Map([...input].map(([file, raw]) => {
    const doc = new SourceDocument(raw);
    for (const repair of options.review?.repairs?.filter(candidate => candidate.file === file) ?? []) {
      if (!selected.has(file) || !repair.source || !repair.reason) throw new Error(`Invalid reviewed repair: ${file}`);
      const from = doc.text.indexOf(repair.source);
      if (from < 0 || doc.text.indexOf(repair.source, from + 1) >= 0) throw new Error(`Reviewed repair must match exactly once: ${file}: ${repair.source}`);
      doc.apply([{ from, to: from + repair.source.length, insert: repair.insert }]);
      repairs.push(repair);
    }
    const model = analyzeMarkdown(doc.text, file);
    return [file, { doc, model, formulas: equations(model), changes: [] as SourceChange[],
      headings: Array.from(extractMetadata(model).headings), headingAnchors: new Map<Heading, string>(),
      anchors: new Map<Equation, string>(), blocked: new Set<Equation>() }] as const;
  }));
  for (const repair of options.review?.repairs ?? []) if (!notes.has(repair.file)) throw new Error(`Reviewed repair file missing: ${repair.file}`);
  const issues: Issue[] = [], retained: Issue[] = [], references: { file: string; line: number; before: string; after: string; target: string; reason?: string }[] = [];
  const globalIds = new Map<string, number>();
  for (const note of notes.values()) for (const anchor of extractMetadata(note.model).blockIds) globalIds.set(anchor.id, (globalIds.get(anchor.id) ?? 0) + 1);
  const allocated = new Set(globalIds.keys());
  const allocate = (file: string, kind: string, from: number) => {
    const base = `${kind}-${createHash('sha256').update(`${file}\0${kind}\0${from}`).digest('hex').slice(0, 16)}`;
    let id = base, suffix = 1;
    while (allocated.has(id)) id = `${base}-${suffix++}`;
    allocated.add(id); return id;
  };
  const manual = new Map<string, { decision: Resolution; equation?: Equation; heading?: Heading; block?: { file: string; id: string }; used: boolean }>();
  const reviewedBlocks = new Map<string, { file: string; id: string }>();
  const manualEquations = new Set<Equation>();
  const sourceKey = (file: string, range: SourceSpan) => `${file}\0${range.from}\0${range.to}`;
  for (const decision of options.review?.resolutions ?? []) {
    const source = notes.get(decision.file), target = notes.get(decision.targetFile);
    if (!source || !target || !selected.has(decision.targetFile) || !decision.source || !decision.reason || !Number.isSafeInteger(decision.occurrence ?? 1) || (decision.occurrence ?? 1) < 1) throw new Error(`Invalid reviewed resolution: ${decision.file}`);
    let from = -1;
    for (let count = 0; count < (decision.occurrence ?? 1); count++) {
      from = source.model.text.indexOf(decision.source, from + 1);
      if (from < 0) throw new Error(`Reviewed reference no longer matches: ${decision.file}: ${decision.source}`);
    }
    const key = sourceKey(decision.file, { from, to: from + decision.source.length });
    if (manual.has(key)) throw new Error(`Duplicate reviewed reference: ${decision.file}`);
    if (decision.targetKind) {
      if (!options.globalReferences || !['callout', 'range'].includes(decision.targetKind) || !decision.targetText) throw new Error(`Invalid reviewed block kind: ${decision.targetFile}`);
      const start = target.model.text.indexOf(decision.targetText);
      if (start < 0 || target.model.text.indexOf(decision.targetText, start + 1) >= 0) throw new Error(`Reviewed block must match exactly once: ${decision.targetFile}`);
      const selection = { from: start, to: start + decision.targetText.length };
      const blockKey = `${sourceKey(decision.targetFile, selection)}\0${decision.targetKind}`;
      let block = reviewedBlocks.get(blockKey);
      if (!block) {
        const prepared = createContentTarget(target.model, selection, decision.targetKind, allocate(decision.targetFile, decision.targetKind, start));
        if (!prepared.changes.length && globalIds.get(prepared.id) !== 1) throw new Error(`Reviewed block ID is not globally unique: ${prepared.id}`);
        target.changes.push(...prepared.changes);
        block = { file: decision.targetFile, id: prepared.id };
        reviewedBlocks.set(blockKey, block);
      }
      manual.set(key, { decision, block, used: false });
    } else {
      const candidates = target.formulas.filter(equation => target.model.text.slice(equation.from, equation.to) === decision.targetText);
      const headings = target.headings.filter(heading => target.model.text.slice(heading.from, heading.to) === decision.targetText);
      if (candidates.length + headings.length !== 1) throw new Error(`Reviewed target must match one structural target: ${decision.targetFile}`);
      manual.set(key, { decision, equation: candidates[0], heading: headings[0], used: false });
      if (candidates[0]) manualEquations.add(candidates[0]);
    }
  }
  const numbered: { file: string; id: string; old: string | null; current: string | null }[] = [];
  let anchorsAdded = 0, anchorsRenamed = 0, tagsRemoved = 0;
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
      if (!manualEquations.has(eq) && eq.tag === undefined && (!eq.id || (!options.globalReferences && equationReferenceName('^' + eq.id) !== undefined))) continue;
      if (eq.ambiguous || !eq.referenceable) {
        note.blocked.add(eq);
        if (options.globalReferences && !eq.ambiguous && !manualEquations.has(eq)) retained.push({ file, line: note.model.text.slice(0, eq.from).split('\n').length, reason: 'Non-referenceable formula retained unchanged', source: note.model.text.slice(eq.from, eq.to) });
        else issue(file, eq, eq.ambiguous ? 'Duplicate block ID' : 'Formula needs its own closing line (or is inside a table)');
        continue;
      }
      if (options.globalReferences) {
        const id = eq.id && equationReferenceName('^' + eq.id) !== undefined && globalIds.get(eq.id) === 1 ? eq.id : allocate(file, 'eq', eq.from);
        note.anchors.set(eq, id);
        if (eq.id !== id) {
          if (eq.anchor) { note.changes.push({ from: eq.anchor.from + 1, to: eq.anchor.to, insert: id }); anchorsRenamed++; }
          else { note.changes.push(equationAnchor(note.model, eq.from, id.slice(3)).change!); anchorsAdded++; }
        }
        continue;
      }
      if (eq.id && equationReferenceName('^' + eq.id) === undefined) {
        const base = `eq-${eq.id}`; let id = base, suffix = 1;
        while (used.has(id)) id = `${base}-${suffix++}`;
        note.changes.push({ from: eq.anchor!.from + 1, to: eq.anchor!.to, insert: id });
        used.add(id); note.anchors.set(eq, id); anchorsRenamed++; continue;
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
    const reviewed = manual.get(sourceKey(sourceFile, range));
    if (reviewed) {
      if (!reviewed.equation) return;
      reviewed.used = true; file = reviewed.decision.targetFile;
    }
    const note = notes.get(file)!;
    // Legacy interpretation belongs only to this explicit offline boundary.
    const key = decode(fragment), legacy = key.match(/^=\((.+)\)(?:§([1-9]\d*))?$/);
    const candidates = key.startsWith('^') ? note.formulas.filter(e => e.id === key.slice(1)) : legacy
      ? note.formulas.filter(e => e.tag !== undefined && normalize(e.tag) === normalize(legacy[1])) : [];
    const eq = reviewed?.equation ?? (legacy?.[2] ? candidates[Number(legacy[2]) - 1] : candidates.length === 1 ? candidates[0] : undefined);
    if (!eq || eq.ambiguous || !note.anchors.has(eq)) {
      // Keep tags needed by an unresolved/ambiguous old reference.
      const label = decode(fragment).match(/^=\((.+)\)(?:§\d+)?$/)?.[1];
      for (const candidate of note.formulas) if (label && candidate.tag && normalize(candidate.tag) === normalize(label)) note.blocked.add(candidate);
      issue(sourceFile, range, `Unresolved or ambiguous formula target: ${file}#${fragment}`);
      return;
    }
    return { eq, id: note.anchors.get(eq)!, file };
  }
  function record(file: string, range: SourceSpan, insert: string, target: string) {
    const note = notes.get(file)!;
    note.changes.push({ ...range, insert });
    references.push({ file, line: note.model.text.slice(0, range.from).split('\n').length,
      before: note.model.text.slice(range.from, range.to), after: insert, target,
      ...(manual.get(sourceKey(file, range)) ? { reason: manual.get(sourceKey(file, range))!.decision.reason } : {}) });
  }
  function headingTarget(file: string, fragment: string, sourceFile: string, range: SourceSpan) {
    const reviewed = manual.get(sourceKey(sourceFile, range));
    if (reviewed) { if (!reviewed.heading) return; file = reviewed.decision.targetFile; reviewed.used = true; }
    const note = notes.get(file)!;
    const target = reviewed?.heading ? undefined : fragmentRange(note.model, fragment) ?? legacySubheadingRange(note.model, fragment);
    const oldHeadings = legacySubheadings(note.model, markdownComments(note.model));
    const normalizeHeading = (value: string) => decode(value).normalize('NFC').replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
    const namedLegacy = oldHeadings.filter(candidate => normalizeHeading(candidate.text) === normalizeHeading(fragment));
    const legacy = target?.kind === 'heading' ? oldHeadings.find(candidate => candidate.from === target.focus.from) : namedLegacy.length === 1 ? namedLegacy[0] : undefined;
    let heading = reviewed?.heading ?? (target?.kind === 'heading' ? note.headings.find(candidate => candidate.from >= target.focus.from && candidate.to <= target.focus.to) : undefined);
    if (!heading && legacy) {
      heading = { from: legacy.from, to: legacy.to, text: legacy.text, level: 7, kind: 'body' };
      note.headings.push(heading);
    }
    if (!heading) return;
    if (!reviewed && !decode(fragment).startsWith('-') && note.headings.filter(candidate => candidate.text.normalize('NFC') === heading.text.normalize('NFC')).length > 1) {
      issue(sourceFile, range, `Ambiguous heading target: ${file}#${fragment}`); return;
    }
    let id = note.headingAnchors.get(heading);
    if (!id) {
      const existing = contentTargets(note.model).targets.find(candidate => candidate.kind === 'heading' && candidate.focus.from === heading.from);
      if (existing && globalIds.get(existing.id) === 1) id = existing.id;
      else {
        id = allocate(file, 'heading', heading.from);
        if (existing) note.changes.push({ from: existing.anchor!.from + 1, to: existing.anchor!.to, insert: id });
        else if (legacy) note.changes.push({ from: legacy.from, to: legacy.to, insert: `####### ${legacy.text} ^${id}` });
        else {
          const old = extractMetadata(note.model).blockIds.find(anchor => anchor.from >= heading.from && anchor.to <= heading.to);
          if (old) note.changes.push({ from: old.from + 1, to: old.to, insert: id });
          else note.changes.push(...createContentTarget(note.model, { from: heading.from, to: heading.from }, 'heading', id).changes);
        }
      }
      note.headingAnchors.set(heading, id);
    }
    return { file, id };
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
      if (/\.[^/.]+$/.test(target.path) && !/\.(?:md|markdown)$/i.test(target.path)) continue;
      const key = decode(target.fragment), legacy = /^=\(.+\)(?:§[1-9]\d*)?$/.test(key);
      if (isGlobalContentTarget(match[1]) || (!legacy && !key.startsWith('^') && (!options.globalReferences || !key))) continue;
      const reviewed = manual.get(sourceKey(file, span));
      const resolved = reviewed ? { status: 'resolved' as const, path: reviewed.decision.targetFile } : resolve(`${target.path}#${target.fragment}`, file);
      if (resolved.status !== 'resolved') {
        if ((legacy || options.globalReferences) && selected.has(file) && resolved.status !== 'external') issue(file, span, `Target note ${resolved.status}: ${target.path}`);
        continue;
      }
      if (!selected.has(resolved.path)) {
        if (legacy && selected.has(file)) issue(file, span, `Target outside --file selection: ${resolved.path}`);
        continue;
      }
      if (options.globalReferences && !notes.has(resolved.path)) continue;
      if (reviewed?.block) {
        reviewed.used = true;
        const separator = tableAlias >= 0 ? '\\|' : '|';
        record(file, span, `${match[0].startsWith('!') ? '!' : ''}[[^${reviewed.block.id}${target.alias === null ? '' : separator + target.alias}]]`, `${reviewed.block.file}#^${reviewed.block.id}`);
        continue;
      }
      if (options.globalReferences && !legacy && !reviewed?.equation) {
        const heading = headingTarget(resolved.path, target.fragment, file, span);
        if (heading) {
          const separator = tableAlias >= 0 ? '\\|' : '|';
          record(file, span, `${match[0].startsWith('!') ? '!' : ''}[[^${heading.id}${target.alias === null ? '' : separator + target.alias}]]`, `${heading.file}#^${heading.id}`);
          continue;
        }
        if (!key.startsWith('^')) { issue(file, span, `Unresolved heading target: ${resolved.path}#${target.fragment}`); continue; }
      }
      if (!legacy && !reviewed?.equation && !notes.get(resolved.path)!.formulas.some(eq => eq.id === key.slice(1) && notes.get(resolved.path)!.anchors.has(eq) && (options.globalReferences || notes.get(resolved.path)!.anchors.get(eq) !== eq.id))) continue;
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
      record(file, span, options.globalReferences ? `${match[0].startsWith('!') ? '!' : ''}[[^${found.id}${tail}` : `${match[0].slice(0, hash + 1)}^${found.id}${trailing}${tail}`, `${found.file}#^${found.id}`);
    }
    // URL ranges come from Lezer, including balanced parentheses and reference definitions.
    // Preserve Markdown labels/titles; only replace the legacy fragment in the URL.
    for (const url of model.nodes.filter(n => n.name === 'URL')) {
      if (inside(url) || math.some(r => overlaps(r, url)) || linkRanges.some(r => overlaps(r, url))) continue;
      const raw = text.slice(url.from, url.to), target = parseLinkTarget(raw);
      if (/\.[^/.]+$/.test(target.path) && !/\.(?:md|markdown)$/i.test(target.path)) continue;
      const key = decode(target.fragment), legacy = /^=\(.+\)(?:§[1-9]\d*)?$/.test(key);
      if (isGlobalContentTarget(raw) || (!legacy && !key.startsWith('^') && (!options.globalReferences || !key))) continue;
      const reviewed = manual.get(sourceKey(file, url));
      const resolved = reviewed ? { status: 'resolved' as const, path: reviewed.decision.targetFile } : resolve(raw, file);
      if (resolved.status !== 'resolved' || !selected.has(resolved.path)) {
        if (legacy && selected.has(file)) issue(file, url, `Markdown target ${resolved.status === 'resolved' ? 'outside --file selection' : resolved.status}: ${raw}`);
        continue;
      }
      if (options.globalReferences && !notes.has(resolved.path)) continue;
      if (reviewed?.block) {
        reviewed.used = true;
        record(file, url, `^${reviewed.block.id}`, `${reviewed.block.file}#^${reviewed.block.id}`);
        continue;
      }
      if (options.globalReferences && !legacy && !reviewed?.equation) {
        const heading = headingTarget(resolved.path, target.fragment, file, url);
        if (heading) { record(file, url, `^${heading.id}`, `${heading.file}#^${heading.id}`); continue; }
        if (!key.startsWith('^')) { issue(file, url, `Unresolved heading target: ${resolved.path}#${target.fragment}`); continue; }
      }
      if (!legacy && !reviewed?.equation && !notes.get(resolved.path)!.formulas.some(eq => eq.id === key.slice(1) && notes.get(resolved.path)!.anchors.has(eq) && (options.globalReferences || notes.get(resolved.path)!.anchors.get(eq) !== eq.id))) continue;
      const found = lookup(resolved.path, target.fragment, file, url); if (!found) continue;
      record(file, url, options.globalReferences ? `^${found.id}` : `${raw.slice(0, raw.indexOf('#') + 1)}^${found.id}`, `${found.file}#^${found.id}`);
    }
    if (!selected.has(file)) continue;
    for (const ref of math) {
      if (!ref.closed || ref.display || ref.kind !== 'dollar' || inside(ref) || linkRanges.some(r => overlaps(r, ref)) ||
        model.nodes.some(n => ['Link', 'Image', 'LinkReference'].includes(n.name) && overlaps(n, ref))) continue;
      const match = ref.tex.match(/^\s*\\text\s*\{\s*\(\s*([\d.\s\u2010-\u2014\u2212-]+)\s*\)\s*\}\s*$/);
      if (!match || !numeric(match[1])) continue;
      const found = lookup(file, `=(${normalize(match[1])})`, file, ref); if (!found) continue;
      record(file, ref, `[[${options.globalReferences ? '' : '#'}^${found.id}]]`, `${found.file}#^${found.id}`);
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
    const before = input.get(file)!;
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
  for (const entry of manual.values()) if (!entry.used) throw new Error(`Reviewed reference was not consumed: ${entry.decision.file}: ${entry.decision.source}`);
  if (options.globalReferences) {
    const targets = new Map<string, { file: string; kind: string }[]>();
    for (const [file, note] of notes) for (const target of contentTargets(analyzeMarkdown(note.doc.text, file)).targets) {
      const group = targets.get(target.id) ?? []; group.push({ file, kind: target.kind }); targets.set(target.id, group);
    }
    for (const reference of references) {
      const hash = reference.target.lastIndexOf('#^'), file = reference.target.slice(0, hash), id = reference.target.slice(hash + 2);
      const candidates = targets.get(id) ?? [];
      if (candidates.length !== 1 || candidates[0].file !== file) throw new Error(`Global target verification failed: ${reference.target}`);
    }
  }
  const tagged = [...selected].reduce((count, file) => count + notes.get(file)!.formulas.filter(eq => eq.tag !== undefined).length, 0);
  return { entries, issues, retained, repairs, references, numbered, summary: { scanned: input.size, selected: selected.size,
    changedFiles: entries.length, anchorsAdded, anchorsRenamed, tagsRemoved, tagsRetained: tagged - tagsRemoved,
    headingsAnchored: [...notes.values()].reduce((count, note) => count + note.headingAnchors.size, 0),
    reviewedBlocksAnchored: reviewedBlocks.size,
    referencesConverted: references.length, reviewedReferences: manual.size, sourceRepairs: repairs.length, retainedUnsafeFormulas: retained.length, unresolved: issues.length } };
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
    'global-references': { type: 'boolean' }, review: { type: 'string' },
  } });
  if (values.help) {
    console.log('node --import tsx scripts/migrate-equations.mts --vault <vault> --out <new-preview-dir> [--file <relative.md>] [--keep-tags] [--drop-number-aliases] [--global-references] [--review <review.json>] [--apply]\nnode --import tsx scripts/migrate-equations.mts --restore <preview-dir>\nDefault: preview only. --global-references migrates heading/equation references to Vault-global typed IDs. --review supplies exact, documented source repairs and target decisions. --file also updates inbound references elsewhere in the vault. --apply requires zero unresolved issues. Close editors before applying/restoring.');
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
  const input = await readVault(vault), options: Options = { files: values.file?.map(f => f.replace(/\\/g, '/')), keepTags: values['keep-tags'], dropNumberAliases: values['drop-number-aliases'],
    globalReferences: values['global-references'], review: values.review ? JSON.parse(await fs.readFile(values.review, 'utf8')) : undefined };
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
