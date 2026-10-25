import { parseSearchQuery } from '@webobsidian/search-core';
import { api } from './api';
import { subscribeSearch } from './search';
import { linkIntent } from './fragmentNavigation';
import { Component } from './obsidian/events';
import { registerCodeProcessor, type CodeBlockContext } from './obsidian/markdown';

const queryResultLimit = 100;

export function installQueryBlocks(): () => void {
  const owner = new Component();
  registerCodeProcessor(owner, 'query', (source, element, context: CodeBlockContext) => {
    const query = source.trim(), parsed = parseSearchQuery(query);
    const pathQuery = parsed.fields.length === 1 && parsed.fields[0] === 'path';
    const status = element.ownerDocument.createElement('div');
    status.setAttribute('role', 'status');
    element.append(status);
    if (!query || (!parsed.filterText && !parsed.include.length && !parsed.exclude.length) ||
      parsed.fields.some(field => field !== 'path') ||
      (parsed.filterText && (!(pathQuery ? /^[\p{L}\p{M}\p{N}_./-]+$/u : /^[\p{L}\p{M}\p{N}]+$/u).test(parsed.filterText) ||
        parsed.filterText.startsWith('/') ||
        /^(?:AND|OR|NOT)$/i.test(parsed.filterText))) || /["'()\[\]]/.test(parsed.text)) {
      status.textContent = '此 query 表达式暂不支持。支持单个字词或 path:相对路径（含 / . _ -），以及 tag:标签 / -tag:标签（也可用 #标签 / -#标签）组合；匹配沿用搜索设置。暂不支持多词、短语、OR、分组、正则、属性、带标点的普通搜索词和其他操作符。';
      return;
    }
    if (pathQuery) {
      const note = element.ownerDocument.createElement('small');
      note.textContent = '路径沿用应用搜索的分词、模糊与前缀设置，尚不支持 Obsidian 的完整路径匹配语义。';
      element.append(note);
    }
    const results = element.ownerDocument.createElement('ul');
    element.append(results);
    let active: AbortController | undefined;
    const run = async () => {
      active?.abort();
      const controller = new AbortController();
      active = controller;
      status.textContent = '搜索中…';
      results.replaceChildren();
      try {
        const { hits } = await api.search(query, queryResultLimit + 1, controller.signal);
        if (controller.signal.aborted || context.signal.aborted) return;
        status.textContent = hits.length > queryResultLimit
          ? `已显示前 ${queryResultLimit} 个结果；还有更多匹配，请缩小搜索范围`
          : hits.length ? `${hits.length} 个结果` : '没有搜索结果';
        for (const hit of hits.slice(0, queryResultLimit)) {
          const row = element.ownerDocument.createElement('li');
          const link = element.ownerDocument.createElement('a');
          link.href = hit.path.split('/').map(encodeURIComponent).join('/');
          link.className = 'internal-link';
          link.textContent = hit.title || hit.path;
          link.title = hit.path;
          link.addEventListener('mousedown', event => { if (event.button < 2) event.preventDefault(); });
          const open = (event: MouseEvent) => {
            if (event.button > 1) return;
            event.preventDefault(); event.stopPropagation();
            context.renderContext.openLink(hit.path, linkIntent(event));
          };
          link.addEventListener('click', open);
          link.addEventListener('auxclick', open);
          row.append(link);
          if (hit.snippet) {
            const snippet = element.ownerDocument.createElement('div');
            snippet.textContent = hit.snippet;
            row.append(snippet);
          }
          results.append(row);
        }
      } catch (error) {
        if (!controller.signal.aborted && !context.signal.aborted)
          status.textContent = `搜索失败：${error instanceof Error ? error.message : String(error)}`;
      } finally {
        if (!controller.signal.aborted && !context.signal.aborted) context.requestMeasure();
      }
    };
    const child = new Component();
    child.register(subscribeSearch(() => { void run(); }));
    child.register(() => active?.abort());
    context.addChild(child);
    return run();
  }, 0, { requiresClosed: true });
  return () => owner.unload();
}
