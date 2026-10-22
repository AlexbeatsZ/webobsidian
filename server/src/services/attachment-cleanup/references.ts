import { analyzeMarkdown, decodeHtmlEntity, extractMetadata, parseYamlSource } from '@webobsidian/markdown-core';
import type { CleanupIssue } from './types.js';

export interface Reference { target: string; relative: boolean }
export interface ReferenceCollection { references: Reference[]; issues: CleanupIssue[]; protectedExtensions?: string[] }

/** Use the shared target resolver later; this layer only decodes source syntax. */
export function collectReferences(path: string, raw: string, options: { literalData?: boolean } = {}): ReferenceCollection {
  const references: Reference[] = [], issues: CleanupIssue[] = [], protectedExtensions = new Set<string>();
  const fail = (code: string, message: string) => issues.push({ path, code, message,
    blocking: !(options.literalData && ['css-syntax', 'css-escape', 'srcset-syntax', 'srcset'].includes(code)) });
  const add = (value: string, relative = false, wiki = false) => {
    let target = value.trim().replace(/^<([\s\S]*)>$/, '$1');
    if (wiki) target = target.split(/(?<!\\)\|/, 1)[0];
    if (!target || /^(?:https?:|data:|mailto:|blob:|tel:|ftp:|\/\/)/i.test(target)) return;
    if (/\$\{|<%|\{\{/.test(target)) {
      const ext = target.match(/\.([a-z\d]{1,12})(?:[?#][^}]*)?$/i)?.[1].toLowerCase();
      if (ext) {
        protectedExtensions.add(ext);
        issues.push({ path, code: 'dynamic-extension', message: '动态目标无法确定，已保护全部 .' + ext + ' 附件', blocking: false });
      } else fail('dynamic-target', '动态附件目标无法界定保护范围：' + target.slice(0, 120));
      return;
    }
    // Escape punctuation before splitting URL fragments, so literal # and | survive.
    target = target.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~ ])/g,
      (_, char: string) => encodeURIComponent(char));
    if (!target || target.startsWith('#')) return;
    if (/^[a-z][a-z\d+.-]*:/i.test(target)) {
      fail('indirect-url', '无法确定本地协议或脚本 URL 的附件依赖：' + target.slice(0, 120)); return;
    }
    target = target.split(/[?#]/, 1)[0];
    try { target = decodeURIComponent(target); }
    catch { fail('encoding', '链接包含无法判定的 URL 编码：' + target.slice(0, 120)); return; }
    if (!target) return;
    // Encode structural characters for parseLinkTarget, which runs before URI decoding.
    target = target.split('/').map((part) => encodeURIComponent(part)).join('/');
    references.push({ target, relative });
  };
  const textTargets = (text: string) => {
    // Include examples/comments/code as positive evidence too: false protection is safe.
    for (const m of text.matchAll(/!?\[\[([^\]\n]+)\]\]/g)) add(m[1], false, true);
    const texMedia = [...text.matchAll(/\\(includegraphics|includepdf)(?:\[[^\]]*\])?\{([^{}]+)\}/g)];
    const protectTexMedia = () => {
      for (const ext of ['png', 'jpg', 'jpeg', 'pdf', 'svg', 'eps', 'bmp', 'gif', 'tif', 'tiff', 'webp', 'avif', 'heic']) protectedExtensions.add(ext);
      issues.push({ path, code: 'tex-media-scope', message: 'TeX 图像搜索目录或动态宏无法确定具体文件，已保护全部图像/PDF类型', blocking: false });
    };
    if (/\\graphicspath\b/.test(text) || (text.match(/\\(?:includegraphics|includepdf)\b/g)?.length ?? 0) !== texMedia.length) protectTexMedia();
    for (const m of texMedia) {
      // TeX also permits extensionless image names. Resolve each supported suffix
      // through the same catalog later, rather than inventing a second resolver.
      if (/\\|#/.test(m[2])) { protectTexMedia(); continue; }
      if (/\.[^/]+$/.test(m[2])) add(m[2], true);
      else for (const ext of ['png', 'jpg', 'jpeg', 'pdf', 'svg', 'eps']) add(m[2] + '.' + ext, true);
    }
    const model = analyzeMarkdown(text, path);
    for (const target of extractMetadata(model).links) add(target);
    // Lezer handles balanced/escaped destinations and reference definitions.
    for (const node of model.nodes) if (node.name === 'URL') add(text.slice(node.from, node.to), true);
    // HTML attributes, quoted/unquoted, including media posters and object embeds.
    for (const m of text.matchAll(/\b(?:src|href|poster|data|xlink:href|data-src|data-href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s'"=<>`]+))/gi))
      add(decodeHtmlEntity(m[1] ?? m[2] ?? m[3]), true);
    const srcsets = [...text.matchAll(/\bsrcset\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)];
    if ((text.match(/\bsrcset\s*=/gi)?.length ?? 0) !== srcsets.length) fail('srcset-syntax', '无法完整解析 srcset 属性');
    for (const m of srcsets) {
      const value = decodeHtmlEntity(m[1] ?? m[2]);
      // Data-URI commas and encoded spaces make naive splitting unsafe.
      if (/data:|\([^)]*,|\\/i.test(value)) fail('srcset', '复杂 srcset 无法完整判定');
      else for (const item of value.split(',')) add(item.trim().split(/\s+/)[0], true);
    }
    for (const m of text.matchAll(/\burl\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|((?:\\.|[^)\\])*))\s*\)/gi)) {
      const value = m[1] ?? m[2] ?? m[3];
      if (/^(?:var|attr)\s*\(/i.test(value.trim())) { fail('dynamic-css', 'CSS 资源由变量生成，无法界定依赖'); continue; }
      if (/\\(?:[\da-f]{1,6}\s?|\r?\n)/i.test(value)) fail('css-escape', 'CSS 十六进制或续行转义需要人工检查');
      else add(decodeHtmlEntity(value), true);
    }
    for (const m of text.matchAll(/@import\s+(?:"([^"]*)"|'([^']*)')/gi)) add(m[1] ?? m[2], true);
    if (!options.literalData && /<(?:script|base)\b|\bon\w+\s*=|\b(?:eval|dv\.io|app\.vault)\s*\(|(?:`{3,}|~{3,})\s*(?:dataview|dataviewjs|templater|query)\b/i.test(text))
      fail('dynamic-reference', '存在动态脚本、查询或 HTML base，无法证明附件未被间接引用');
    // A missing CSS close/unsupported image-set must not silently drop dependencies.
    if ((text.match(/\burl\s*\(/gi)?.length ?? 0) !==
      (text.match(/\burl\(\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|(?:\\.|[^)\\])*)\s*\)/gi)?.length ?? 0) ||
      /(?:image-set|(?:-webkit-)?image)\s*\(/i.test(text))
      fail('css-syntax', '存在无法完整解析的 CSS 资源表达式');
  };
  const strings = (value: unknown, depth = 0) => {
    if (depth > 80) throw new Error('结构嵌套过深');
    if (typeof value === 'string') {
      textTargets(value);
      // Plain string properties may be paths with spaces; overprotection is intentional.
      if (/\.[\p{L}\p{N}]{1,12}(?:[?#].*)?$/u.test(value.trim())) add(value);
    } else if (Array.isArray(value)) for (const item of value) strings(item, depth + 1);
    else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
      strings(key, depth + 1); strings(item, depth + 1);
    }
  };
  try {
    const text = raw.replace(/^\ufeff/, '').replace(/\r\n|\r/g, '\n');
    const ext = path.split('.').at(-1)?.toLowerCase();
    if (ext === 'canvas' || ext === 'json') {
      const data: unknown = JSON.parse(text);
      if (ext === 'canvas') {
        const canvas = data as { nodes?: unknown[]; edges?: unknown[] };
        if (!canvas || !Array.isArray(canvas.nodes) || !Array.isArray(canvas.edges)) throw new Error('Canvas nodes/edges 无效');
        for (const node of canvas.nodes) {
          const n = node as Record<string, unknown>;
          if (!n || !['text', 'file', 'link', 'group'].includes(String(n.type))) throw new Error('未知 Canvas 节点');
          if (n.type === 'file') {
            if (typeof n.file !== 'string') throw new Error('Canvas file 路径无效');
            add(n.file);
          }
          if (n.type === 'text' && typeof n.text !== 'string') throw new Error('Canvas text 无效');
        }
      }
      strings(data);
    } else if (ext === 'yaml' || ext === 'yml' || ext === 'base') {
      const document = parseYamlSource(text);
      if (document.errors.length || document.warnings.length) throw new Error('YAML 无效或包含未知标签');
      strings(document.toJS({ maxAliasCount: 100 }));
      if (ext === 'base') fail('base-query', 'Base 查询可能动态引用附件；本轮仅保护，不清理');
    } else {
      textTargets(text);
      if (/^---\s*\n/.test(text)) {
        const fm = text.match(/^---[ \t]*\n([\s\S]*?)\n(?:---|\.\.\.)[ \t]*(?:\n|$)/);
        if (!fm) throw new Error('frontmatter 缺少结束标记');
        const document = parseYamlSource(fm[1]);
        if (document.errors.length || document.warnings.length) throw new Error('frontmatter 无效或包含未知标签');
        strings(document.toJS({ maxAliasCount: 100 }));
      }
    }
  } catch (error) { fail('parse', '引用解析不完整：' + String(error)); }
  return { references, issues, protectedExtensions: [...protectedExtensions] };
}
