import { EditorSelection, Prec, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { analyzeMarkdown, contentTargets, extractMetadata, isGlobalContentTarget, parseLinkTarget, type MarkdownModel, type SourceSpan } from '@webobsidian/markdown-core';
import { syntaxModel } from './syntaxModel';
import { writingOperation } from './writing/editing';

export const CONTENT_CLIPBOARD_MIME = 'application/x-webobsidian-content+json';
const browserMime = `web ${CONTENT_CLIPBOARD_MIME}`;
interface Payload {
  version: 1;
  source: string;
  token: string;
  mode: 'copy' | 'cut';
  text: string;
  ids: string[];
}
interface CutEntry { payload: Payload; source: () => MarkdownModel | undefined; moved: boolean }
export interface ClipboardContent { text: string; metadata?: string }
export interface ClipboardOptions {
  source: () => { identity: string; model: MarkdownModel; offset: number; read: () => MarkdownModel | undefined };
  writable: () => boolean;
  projection: () => boolean;
  format: (text: string, view: EditorView) => string;
  reportError: (error: unknown) => void;
}

function definitionBounds(target: ReturnType<typeof contentTargets>['targets'][number]): SourceSpan {
  return { from: Math.min(target.from, ...target.protectedSpans.map(span => span.from)),
    to: Math.max(target.to, ...target.protectedSpans.map(span => span.to)) };
}

export class ContentClipboardPolicy {
  private cuts = new Map<string, CutEntry>();
  capture(model: MarkdownModel, selection: SourceSpan, source: string, mode: Payload['mode'], currentSource: () => MarkdownModel | undefined): ClipboardContent {
    const text = model.text.slice(selection.from, selection.to);
    const complete = (selection.from === 0 || model.text[selection.from - 1] === '\n') &&
      (selection.to === model.text.length || model.text[selection.to] === '\n' || model.text[selection.to - 1] === '\n');
    const ids = complete ? contentTargets(model).targets.filter(target => {
      const bounds = definitionBounds(target);
      return bounds.from >= selection.from && (bounds.to <= selection.to || !model.text.slice(selection.to, bounds.to).trim());
    }).map(target => target.id) : [];
    const payload: Payload = { version: 1, source, mode, text, ids, token: crypto.randomUUID() };
    if (mode === 'cut') {
      this.cuts.set(payload.token, { payload, source: currentSource, moved: false });
      if (this.cuts.size > 64) this.cuts.delete(this.cuts.keys().next().value!);
    }
    return { text, metadata: JSON.stringify(payload) };
  }
  prepare(content: ClipboardContent, destination: MarkdownModel, allowMove = true): { text: string; commit: () => void } {
    const unchanged = () => ({ text: content.text, commit: () => {} });
    if (!content.metadata) return unchanged();
    let payload: Payload;
    try {
      payload = JSON.parse(content.metadata);
      if (payload.version !== 1 || payload.text !== content.text || typeof payload.source !== 'string' ||
        typeof payload.token !== 'string' || !['copy', 'cut'].includes(payload.mode) ||
        !Array.isArray(payload.ids) || payload.ids.some(id => typeof id !== 'string')) return unchanged();
    } catch { return unchanged(); }
    const model = analyzeMarkdown(content.text);
    const definitions = contentTargets(model).targets.filter(target => payload.ids.includes(target.id));
    if (!definitions.length) return unchanged();
    const entry = this.cuts.get(payload.token);
    const source = entry?.source();
    const idsIn = (candidate: MarkdownModel) => {
      const metadata = contentTargets(candidate);
      return new Set([...metadata.targets.map(target => target.id), ...metadata.issues.map(issue => issue.id)]);
    };
    const sourceIds = source ? idsIn(source) : undefined;
    const destinationIds = idsIn(destination);
    const move = allowMove && payload.mode === 'cut' && entry && !entry.moved && entry.payload.text === payload.text &&
      JSON.stringify(entry.payload.ids) === JSON.stringify(payload.ids) &&
      entry.payload.source === payload.source && sourceIds && definitions.every(target => !sourceIds.has(target.id) && !destinationIds.has(target.id));
    if (move) return { text: content.text, commit: () => { entry.moved = true; } };
    const mapping = new Map(definitions.map(target => [target.id, `${target.id.split('-')[0]}-${crypto.randomUUID().replace(/-/g, '')}`]));
    const edits: { from: number; to: number; insert: string }[] = [];
    for (const target of definitions) for (const span of target.protectedSpans) {
      const token = '^' + target.id;
      const raw = model.text.slice(span.from, span.to);
      if (raw.startsWith(token)) edits.push({ from: span.from + 1, to: span.from + token.length, insert: mapping.get(target.id)! });
    }
    const metadata = extractMetadata(model);
    const remap = (span: SourceSpan, raw: string) => {
      const destination = raw.trim().replace(/^<|>$/g, '');
      const parsed = parseLinkTarget(destination);
      const ownPath = parsed.path && parsed.path.replace(/\.(md|markdown)$/i, '') === payload.source.replace(/\.(md|markdown)$/i, '');
      if (!(isGlobalContentTarget(destination) || ((!parsed.path || ownPath) && parsed.fragment.startsWith('^')))) return;
      const id = parsed.fragment.slice(1), replacement = mapping.get(id);
      if (!replacement) return;
      if (ownPath) {
        const at = raw.indexOf(destination);
        edits.push({ from: span.from + at, to: span.from + at + destination.length, insert: '^' + replacement });
        return;
      }
      const at = raw.indexOf('^' + id);
      if (at >= 0) edits.push({ from: span.from + at + 1, to: span.from + at + 1 + id.length, insert: replacement });
    };
    for (const link of metadata.linkOccurrences) {
      if (link.kind === 'wiki') {
        const from = link.from + (link.embed ? 3 : 2);
        const raw = model.text.slice(from, link.to - 2);
        const alias = raw.search(/(?<!\\)\|/);
        remap({ from, to: link.to - 2 }, alias < 0 ? raw : raw.slice(0, alias));
      }
    }
    for (const node of model.nodes) if (node.name === 'URL' &&
      (metadata.linkOccurrences.some(link => link.kind !== 'wiki' && node.from >= link.from && node.to <= link.to) ||
        metadata.linkDefinitions.some(definition => node.from >= definition.from && node.to <= definition.to)))
      remap(node, model.text.slice(node.from, node.to));
    let text = model.text;
    for (const edit of edits.sort((left, right) => right.from - left.from)) text = text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
    return { text, commit: () => { if (entry) entry.moved = true; } };
  }
}

const policy = new ContentClipboardPolicy();

export function contentClipboard(options: ClipboardOptions) {
  const writable = (view: EditorView) => !view.state.readOnly && options.writable();
  const capture = (view: EditorView, cut: boolean) => {
    if (view.state.selection.ranges.length !== 1 || view.state.selection.main.empty) return undefined;
    const { from, to } = view.state.selection.main, source = options.source();
    return policy.capture(source.model, { from: from + source.offset, to: to + source.offset }, source.identity,
      cut && !options.projection() ? 'cut' : 'copy', source.read);
  };
  const remove = (view: EditorView) => {
    if (!writable(view)) return;
    view.dispatch({ ...view.state.replaceSelection(''), userEvent: 'delete.cut' });
  };
  const apply = (view: EditorView, content: ClipboardContent) => {
    if (!writable(view) || view.composing || !content.text) return false;
    const before = view.state;
    const prepared: ReturnType<ContentClipboardPolicy['prepare']>[] = [];
    const changes = before.changeByRange(range => {
      const result = policy.prepare(content, before.field(syntaxModel), before.selection.ranges.length === 1);
      prepared.push(result);
      const text = content.metadata ? result.text : options.format(result.text, view);
      return { changes: { from: range.from, to: range.to, insert: text }, range: EditorSelection.cursor(range.from + text.length) };
    });
    view.dispatch({ ...changes, annotations: writingOperation.of('paste'), userEvent: 'input.paste' });
    if (!view.state.doc.eq(before.doc)) for (const result of prepared) result.commit();
    return true;
  };
  const write = async (content: ClipboardContent) => {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write && content.metadata) {
      try {
        await navigator.clipboard.write([new ClipboardItem({
          'text/plain': new Blob([content.text], { type: 'text/plain' }),
          [browserMime]: new Blob([content.metadata], { type: CONTENT_CLIPBOARD_MIME }),
        })]);
        return;
      } catch { }
    }
    if (content.metadata && (JSON.parse(content.metadata) as Payload).ids.length)
      throw new Error('当前剪贴板不支持内容标识格式，复制或剪切未完成');
    await navigator.clipboard.writeText(content.text);
  };
  const extension: Extension = Prec.highest(EditorView.domEventHandlers({
    copy(event, view) {
      if (!event.clipboardData) return false;
      const content = capture(view, false);
      if (!content) return false;
      event.clipboardData.setData('text/plain', content.text);
      event.clipboardData.setData(CONTENT_CLIPBOARD_MIME, content.metadata!);
      event.preventDefault();
      return true;
    },
    cut(event, view) {
      if (!writable(view)) { event.preventDefault(); event.stopPropagation(); return true; }
      if (!event.clipboardData) return false;
      const content = capture(view, true);
      if (!content) return false;
      event.clipboardData.setData('text/plain', content.text);
      event.clipboardData.setData(CONTENT_CLIPBOARD_MIME, content.metadata!);
      event.preventDefault();
      try { remove(view); } catch (error) { options.reportError(error); }
      return true;
    },
    paste(event, view) {
      if (!writable(view)) { event.preventDefault(); event.stopPropagation(); return true; }
      if (!event.clipboardData || view.composing) return false;
      if (event.clipboardData.files.length) { event.preventDefault(); return true; }
      const metadata = event.clipboardData.getData(CONTENT_CLIPBOARD_MIME) || event.clipboardData.getData(browserMime);
      if (!metadata) return false;
      event.preventDefault();
      try { apply(view, { text: event.clipboardData.getData('text/plain'), metadata }); }
      catch (error) { options.reportError(error); }
      return true;
    },
  }));
  return { extension,
    async copy(view: EditorView, cut = false) {
      if (cut && !writable(view)) return;
      const before = view.state, content = capture(view, cut);
      if (!content) return;
      try {
        await write(content);
        if (view.state !== before) return;
        if (cut && writable(view)) remove(view);
        view.focus();
      } catch (error) { options.reportError(error); }
    },
    async paste(view: EditorView) {
      if (!writable(view)) return;
      const before = view.state;
      try {
        let content: ClipboardContent | undefined;
        if (navigator.clipboard.read) {
          try {
            const items = await navigator.clipboard.read();
            if (items.some(item => item.types.some(type => type.startsWith('image/')))) return;
            for (const item of items) if (item.types.includes('text/plain')) {
              const metadataType = item.types.find(type => type === browserMime || type === CONTENT_CLIPBOARD_MIME);
              content = { text: await (await item.getType('text/plain')).text(),
                metadata: metadataType ? await (await item.getType(metadataType)).text() : undefined };
              break;
            }
          } catch { }
        }
        content ??= { text: await navigator.clipboard.readText() };
        if (view.state === before && writable(view)) { apply(view, content); view.focus(); }
      } catch (error) { options.reportError(error); }
    },
  };
}
