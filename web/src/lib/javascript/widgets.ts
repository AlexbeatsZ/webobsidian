// Personal views adapted from Interactive JS 0.1.0. Copyright (c) 2026 Meta, MIT.
import type { TFile, TFolder } from '../obsidian/vault';
import type { JavascriptRun } from './runtime';
import { createEl } from '../obsidian/dom';
import { compileJavascript } from './execute';
import { blockContainers, extractMetadata, legacySubheadings } from '@webobsidian/markdown-core';
type WidgetHost = JavascriptRun;
const collator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' });
export interface UptimerOptions {
  filePath?: string;
  configNotePath?: string;
  isDailyView?: boolean;
  cardWidth?: string;
}

export interface FolderTagOverviewOptions {
  mode: "folders" | "rules";
  configMarker?: string;
}

export interface OutlineOptions {
  target?: string | { path?: string };
}

export interface CalloutOptions {
  note: string;
  type: string;
}

interface UptimerLog {
  item_title: string;
  start_time: number;
  end_time: number;
  total_time: number;
  start_time_str?: string;
  tags?: Array<{ title: string }>;
  content?: string;
  is_gap?: boolean;
  icon?: string;
  color?: string;
}

interface ActivityStyle {
  color: string;
  icon: string;
}

interface FolderRule {
  folder?: string;
  tags?: unknown[];
}

interface FolderTagConfig {
  managedRoots?: unknown[];
  typeRules?: FolderRule[];
  subjectRules?: FolderRule[];
}

interface OutlineItem {
  type: "heading" | "subheading";
  level: number;
  text: string;
  linkValue: string;
}

interface OutlineNode extends OutlineItem {
  children: OutlineNode[];
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function basenameWithoutExtension(path: string): string {
  const name = path.split("/").pop() ?? path;
  return name.replace(/\.[^.]+$/, "");
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}



async function readText(host: WidgetHost, path: string): Promise<string | null> {
  if (!host.app.vault.getFileByPath(path)) { host.watch(path); return null; }
  return (await host.note(path)).snapshot.raw;
}

function addParagraph(container: HTMLElement, text: string): void {
  createEl('p', { text, parent: container });
}

function createInternalLink(
  host: WidgetHost,
  parent: HTMLElement,
  path: string,
  label: string,
  href = path
): HTMLAnchorElement {
  const link: HTMLAnchorElement = createEl("a", {
    parent,
    cls: "internal-link",
    text: label,
    attr: { href },
  });
  link.dataset.href = href;
  link.addEventListener('click', event => { event.preventDefault(); host.context.openLink(href); });
  return link;
}

function createTable(
  container: HTMLElement,
  headers: string[],
  rows: Array<Array<unknown>>
): HTMLTableElement {
  const table: HTMLTableElement = createEl('table', { cls: 'table-view-table', parent: container });
  const thead = createEl('thead', { parent: table });
  const headerRow = createEl('tr', { parent: thead });
  for (const header of headers) {
    createEl('th', { text: header, parent: headerRow });
  }
  const tbody = createEl('tbody', { parent: table });
  for (const row of rows) {
    const tr = createEl('tr', { parent: tbody });
    for (const value of row) {
      createEl('td', { text: String(value ?? ''), parent: tr });
    }
  }
  return table;
}

async function parseFolderTagConfig(host: WidgetHost, marker: string): Promise<FolderTagConfig> {
  const note = await host.note(host.sourcePath);
  const block = blockContainers(note.analysis).find(block => block.kind === 'code' &&
    /^(js|javascript)$/i.test(block.language) && block.body.match(/^[\t ]*\/\/[\t ]*([^\r\n]*)/)?.[1].trim() === marker);
  if (!block) throw new Error('找不到 ' + marker + ' 代码块.');
  return await compileJavascript('return (' + block.body.split('\n').slice(1).join('\n').trim() + ');', [],
    'webobsidian-js/config/' + encodeURIComponent(host.sourcePath))() as FolderTagConfig;
}

function renderTag(tagTitle: string, tagConfig: Record<string, string>): string {
  const color = tagConfig[tagTitle];
  if (color) {
    return `<span style="background:${escapeHtml(color)}; color:#fff; padding:1px 6px; border-radius:4px; font-size:0.75em; margin-right:4px;">#${escapeHtml(tagTitle)}</span>`;
  }
  return `<span style="background: rgba(100,100,100,0.15); color: var(--text-muted); padding: 1px 6px; border-radius: 4px; font-size: 0.75em; margin-right: 4px;">#${escapeHtml(tagTitle)}</span>`;
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}时${minutes}分` : `${minutes}分`;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function getActivityStyle(
  title: string,
  activityConfig: Record<string, ActivityStyle>
): ActivityStyle {
  for (const key of Object.keys(activityConfig)) {
    if (title.includes(key)) {
      return activityConfig[key] ?? {
        color: "var(--interactive-accent)",
        icon: ""
      };
    }
  }
  return (
    activityConfig["默认"] ?? {
      color: "var(--interactive-accent)",
      icon: ""
    }
  );
}

function parseUptimerLogs(
  content: string,
  matchDate: string,
  isDailyView: boolean
): UptimerLog[] {
  const logs: UptimerLog[] = [];
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as UptimerLog;
      if (!isDailyView || parsed.start_time_str?.startsWith(matchDate)) {
        logs.push(parsed);
      }
    } catch {
      // Preserve the former view's behavior: malformed exported lines are ignored.
    }
  }
  return logs.reverse().sort((left, right) => right.start_time - left.start_time);
}

function insertUptimerGaps(logs: UptimerLog[]): UptimerLog[] {
  const result: UptimerLog[] = [];
  for (let index = 0; index < logs.length; index += 1) {
    const current = logs[index];
    if (!current) continue;
    const next = logs[index + 1];
    result.push(current);
    if (next && current.start_time > next.end_time) {
      result.push({
        item_title: "空闲",
        start_time: next.end_time,
        end_time: current.start_time,
        total_time: current.start_time - next.end_time,
        is_gap: true,
        icon: "",
        color: "rgba(100, 100, 100, 0.2)"
      });
    }
  }
  return result;
}

function getDateString(log: UptimerLog): string {
  if (log.start_time_str) return log.start_time_str.split(" ")[0] ?? "";
  const date = new Date(log.start_time * 1000);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function renderDateDivider(date: string, isFirst: boolean): string {
  if (isFirst) {
    return `<div style="text-align: center; margin: 10px 0 20px 0; color: var(--text-muted); font-size: 0.9em; font-weight: bold;">${escapeHtml(date)}</div>`;
  }
  return `<div style="text-align: center; margin: 20px 0; color: var(--text-muted); font-size: 0.9em; border-bottom: 1px solid var(--background-modifier-border); line-height: 0.1em;"><span style="background: var(--background-primary); padding: 0 10px;">${escapeHtml(date)}</span></div>`;
}

function renderUptimerLog(
  log: UptimerLog,
  index: number,
  finalLogs: UptimerLog[],
  activityConfig: Record<string, ActivityStyle>,
  tagConfig: Record<string, string>
): string {
  const isGap = log.is_gap ?? false;
  const style = isGap
    ? { color: log.color ?? "rgba(100, 100, 100, 0.2)", icon: log.icon ?? "" }
    : getActivityStyle(log.item_title, activityConfig);
  const background = isGap ? "transparent" : "var(--background-secondary)";
  const border = isGap
    ? "1px dashed var(--background-modifier-border)"
    : "0.5px solid var(--background-modifier-border)";
  const titleColor = isGap ? "var(--text-muted)" : "var(--text-normal)";
  const tags =
    !isGap && Array.isArray(log.tags) && log.tags.length > 0
      ? `<div style="margin-top: 4px;">${log.tags.map((tag) => renderTag(tag.title, tagConfig)).join("")}</div>`
      : "";
  const description =
    !isGap && log.content
      ? `<div style="font-size: 0.85em; color: var(--text-muted); margin-top: 4px;">${escapeHtml(log.content)}</div>`
      : "";

  return `
  <div style="display: flex; align-items: stretch;">
    <div style="width: 65px; flex-shrink: 0; text-align: right; padding-right: 10px; display: flex; flex-direction: column; justify-content: space-between; position: relative; padding-top: 0px; padding-bottom: 0px;">
      <div style="position: absolute; top: -10px; right: 10px; font-size: 0.95em; font-weight: bold; color: var(--text-normal); z-index: 1; background: var(--background-primary); padding: 2px 0;">${formatTime(log.end_time)}</div>
      ${index === finalLogs.length - 1 ? `<div style="position: absolute; bottom: -10px; right: 10px; font-size: 0.95em; font-weight: bold; color: var(--text-normal); z-index: 1; background: var(--background-primary); padding: 2px 0;">${formatTime(log.start_time)}</div>` : ""}
    </div>
    <div style="width: 4px; background-color: ${escapeHtml(style.color)}; border-radius: 4px; margin-right: 10px; flex-shrink: 0; opacity: 0.8;"></div>
    <div style="flex: 1; background: ${background}; border-radius: 4px; padding: 12px 16px; border: ${border};">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
        <div style="font-weight: bold; font-size: 1.05em; display: flex; align-items: center; gap: 6px; color: ${titleColor};">
          <span style="font-size: 1.1em;">${escapeHtml(style.icon)}</span>
          <span>${escapeHtml(log.item_title)}</span>
        </div>
        <div style="font-size: 0.85em; font-family: monospace; color: var(--text-muted);">⏱ ${formatDuration(log.total_time)}</div>
      </div>
      ${tags}
      ${description}
    </div>
  </div>`;
}

async function uptimer(host: WidgetHost, options: UptimerOptions = {}): Promise<void> {
  const filePath = options.filePath ?? "06记录/UpTimer/UpTimer.md";
  const configNotePath =
    options.configNotePath ?? "06记录/UpTimer/UpTimer Config.md";
  const isDailyView = options.isDailyView ?? true;
  const cardWidth = options.cardWidth ?? "100%";
  host.watch(filePath);
  host.watch(configNotePath);

  const [content, configContent] = await Promise.all([
    readText(host, filePath),
    readText(host, configNotePath)
  ]);
  if (!content) {
    addParagraph(host.container, "⚠️ 无法读取数据文件");
    return;
  }
  if (!configContent) {
    addParagraph(host.container, "⚠️ 无法读取配置文件");
    return;
  }

  const configNote = await host.note(configNotePath);
  const json = blockContainers(configNote.analysis).find(block => block.kind === 'code' && block.language.toLowerCase() === 'json');
  const parsedConfig = json
    ? (JSON.parse(json.body) as {
        activityConfig?: Record<string, ActivityStyle>;
        tagConfig?: Record<string, string>;
      })
    : {};
  const matchDate = basenameWithoutExtension(host.sourcePath);
  const logs = insertUptimerGaps(parseUptimerLogs(content, matchDate, isDailyView));
  if (logs.length === 0) {
    addParagraph(host.container, `📅 ${matchDate} 没有有效记录`);
    return;
  }

  let html = `<div style="display: flex; flex-direction: column; gap: 12px; margin-top: 10px; width: ${escapeHtml(cardWidth)};">`;
  let lastDate = "";
  for (let index = 0; index < logs.length; index += 1) {
    const log = logs[index];
    if (!log) continue;
    if (!isDailyView) {
      const currentDate = getDateString(log);
      if (currentDate !== lastDate) {
        html += renderDateDivider(currentDate, lastDate === "");
        lastDate = currentDate;
      }
    }
    html += renderUptimerLog(
      log,
      index,
      logs,
      parsedConfig.activityConfig ?? {},
      parsedConfig.tagConfig ?? {}
    );
  }
  html += "</div>";
  host.container.innerHTML = html;
}

async function directoryIndex(host: WidgetHost): Promise<void> {
  const directory = host.sourcePath.split('/').slice(0, -1).join('/');
  host.watchDirectory(directory);
  const folder = host.app.vault.getFolderByPath(directory);
  const targetFiles: TFile[] = [];
  const walk = (node: { path: string; children?: unknown[] }) => {
    if ('children' in node) for (const child of node.children ?? []) walk(child as typeof node);
    else { const file = host.app.vault.getFileByPath(node.path); if (file) targetFiles.push(file); }
  };
  for (const child of folder?.children ?? []) if ('children' in child && child.name.includes('正文')) walk(child as TFolder);
  for (const extension of ['pdf', 'md']) {
    createEl('h1', { text: extension.toUpperCase(), parent: host.container });
    const files = targetFiles.filter(file => file.extension.toLowerCase() === extension).sort((a, b) => collator.compare(a.path, b.path));
    if (!files.length) { addParagraph(host.container, '未找到文件。'); continue; }
    const list = createEl('ul', { cls: 'dataview list-view-ul', parent: host.container });
    for (const file of files) createInternalLink(host, createEl('li', { parent: list }), file.path, extension === 'pdf' ? file.name : file.basename);
  }
}

async function folderTagOverview(
  host: WidgetHost,
  options: FolderTagOverviewOptions
): Promise<void> {
  const marker = options.configMarker ?? "folder-tag-sync-config";
  host.watch(host.sourcePath);
  const content = await readText(host, host.sourcePath);
  if (content === null) {
    addParagraph(host.container, `找不到文件:${host.sourcePath}`);
    return;
  }

  let config: FolderTagConfig;
  try {
    config = await parseFolderTagConfig(host, marker);
  } catch (error) {
    addParagraph(
      host.container,
      error instanceof Error ? error.message : String(error)
    );
    return;
  }
  const roots = asArray<string>(config.managedRoots);
  const rules = [
    ...asArray<FolderRule>(config.typeRules),
    ...asArray<FolderRule>(config.subjectRules)
  ];

  if (options.mode === "rules") {
    createTable(
      host.container,
      ["文件夹", "标签"],
      rules.map((rule) => [rule.folder ?? "", asArray(rule.tags).join(", ")])
    );
    return;
  }

  host.watchDirectory('');
  const configuredFolders = new Set(
    rules.map((rule) => rule.folder).filter((folder): folder is string => Boolean(folder))
  );
  const counts = new Map<string, number>();
  const count = (node: { path: string; children?: unknown[] }): number => {
    if (!('children' in node)) return /\.(md|markdown)$/i.test(node.path) ? 1 : 0;
    let total = 0; for (const child of node.children ?? []) total += count(child as typeof node);
    if (total && roots.some(root => node.path === root || node.path.startsWith(root + '/'))) counts.set(node.path, total);
    return total;
  };
  count(host.app.vault.getRoot());
  const rows = [...counts.entries()]
    .sort(([left], [right]) => collator.compare(left, right))
    .map(([folder, count]) => [
      folder,
      count,
      configuredFolders.has(folder) ? "已配置" : "未配置"
    ]);
  createTable(host.container, ["文件夹", "笔记数", "规则"], rows);
}

function resolveTargetFile(host: WidgetHost, target: OutlineOptions["target"]): TFile | null {
  if (target && typeof target === "object" && target.path) return host.app.vault.getFileByPath(target.path);
  if (typeof target === "string" && target.trim()) {
    const wikiMatch = target.match(/^\[\[([^|\]]*)/);
    const linkText = wikiMatch ? wikiMatch[1]?.trim() : target.trim();
    if (linkText) {
      return host.app.metadataCache.getFirstLinkpathDest(linkText, host.sourcePath);
    }
  }
  return host.app.vault.getFileByPath(host.sourcePath);
}

function collectOutlineItems(model: Parameters<typeof extractMetadata>[0] & object): OutlineItem[] {
  const meta = extractMetadata(model);
  const entries = [...meta.headings.map(heading => ({ ...heading, type: 'heading' as const, link: heading.text })),
    ...legacySubheadings(model, meta.comments).map(heading => ({ ...heading, type: 'subheading' as const, level: 0, link: heading.fragment }))]
    .sort((a, b) => a.from - b.from);
  let level = 0;
  return entries.map(entry => {
    if (entry.type === 'heading' && entry.level <= 6) level = entry.level;
    return { type: entry.type, level: entry.type === 'subheading' ? level + 1 : entry.level,
      text: entry.text, linkValue: entry.link };
  });
}

function buildOutlineTree(items: OutlineItem[]): OutlineNode[] {
  const root: { children: OutlineNode[] } = { children: [] };
  const stack: Array<{ level: number; node: { children: OutlineNode[] } }> = [
    { level: 0, node: root }
  ];
  for (const item of items) {
    const node: OutlineNode = { ...item, children: [] };
    while (stack.length > 1 && (stack.at(-1)?.level ?? 0) >= item.level) {
      stack.pop();
    }
    stack.at(-1)?.node.children.push(node);
    stack.push({ level: item.level, node });
  }
  return root.children;
}

function renderOutlineNodes(
  host: WidgetHost,
  nodes: OutlineNode[],
  parent: HTMLElement,
  file: TFile,
  isRoot = false
): void {
  const list = createEl('ul', { parent });
  if (isRoot) list.classList.add("tree-root");
  for (const node of nodes) {
    const item = createEl("li", {
      parent: list,
      cls:
        node.type === "subheading"
          ? "subheading-node"
          : `heading-level-${node.level}`
    });
    const href = file.path + '#' + encodeURIComponent(node.linkValue);
    const link = createInternalLink(host, item, file.path, '', href);
    link.classList.add("tree-item");
    createEl('span', { cls: 'tree-dot', parent: link });
    createEl('span', { cls: 'tree-label', text: node.text, parent: link });
    if (node.children.length > 0) {
      renderOutlineNodes(host, node.children, item, file);
    }
  }
}

async function outline(host: WidgetHost, options: OutlineOptions = {}): Promise<void> {
  const file = resolveTargetFile(host, options.target);
  if (!file) {
    addParagraph(host.container, `找不到目标笔记：${String(options.target ?? host.sourcePath)}`);
    return;
  }
  host.watch(file.path);
  const note = await host.note(file.path);
  const items = collectOutlineItems(note.analysis);
  if (items.length === 0) {
    addParagraph(host.container, "该笔记中没有检测到标题或 sub 标题。");
    return;
  }
  const tree = createEl('div', { cls: 'pure-subheading-tree', parent: host.container });
  renderOutlineNodes(
    host,
    buildOutlineTree(items),
    tree,
    file,
    true
  );
}

async function callouts(host: WidgetHost, options: CalloutOptions): Promise<void> {
  const target = host.app.metadataCache.getFirstLinkpathDest(options.note, host.sourcePath);
  if (!target) { addParagraph(host.container, '找不到文件:' + options.note); return; }
  const note = await host.note(target.path);
  const matches = blockContainers(note.analysis).filter(block => block.kind === 'callout' && block.type === options.type.toLowerCase());
  const outer = matches.filter(block => !matches.some(parent => parent !== block && parent.from <= block.from && parent.to >= block.to));
  if (!outer.length) { addParagraph(host.container, '在 [[' + options.note + ']] 中没有找到类型为' + options.type + ' 的 Callout.'); return; }
  const context = await host.targetContext(target.path);
  // Render each exact source slice with the target note's link/media context.
  for (const block of outer) {
    const output = createEl('div', { parent: host.container });
    await host.renderMarkdown(note.analysis.text.slice(block.from, block.to), output, context);
  }
}

export function createWidgets(host: WidgetHost) {
  return {
    uptimer: (options?: UptimerOptions) => uptimer(host, options),
    directoryIndex: () => directoryIndex(host),
    folderTagOverview: (options: FolderTagOverviewOptions) =>
      folderTagOverview(host, options),
    outline: (options?: OutlineOptions) => outline(host, options),
    callouts: (options: CalloutOptions) => callouts(host, options)
  };
}

export type WidgetLibrary = ReturnType<typeof createWidgets>;
