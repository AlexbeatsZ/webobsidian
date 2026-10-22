import type { ScriptMetadata, ScriptRecord } from '../../../web/src/lib/userscripts/types';

export const SUPPORTED_GRANTS = new Set([
  'none', 'unsafeWindow', 'GM_info', 'GM.info', 'GM_log', 'GM.log',
  'GM_getValue', 'GM_setValue', 'GM_deleteValue', 'GM_listValues',
  'GM_getValues', 'GM_setValues', 'GM_deleteValues',
  'GM_addValueChangeListener', 'GM_removeValueChangeListener',
  'GM_addStyle', 'GM_addElement', 'GM_getResourceText', 'GM_getResourceURL',
  'GM_registerMenuCommand', 'GM_unregisterMenuCommand', 'GM_xmlhttpRequest',
  'GM_setClipboard', 'GM_notification',
  ...['getValue', 'setValue', 'deleteValue', 'listValues', 'getValues', 'setValues', 'deleteValues',
    'addValueChangeListener', 'removeValueChangeListener', 'addStyle', 'addElement',
    'getResourceText', 'getResourceUrl', 'getResourceURL', 'registerMenuCommand',
    'unregisterMenuCommand', 'xmlHttpRequest', 'setClipboard', 'notification'].map(k => 'GM.' + k),
]);
const runAts = ['document-start', 'document-body', 'document-end', 'document-idle'];
export function parseMetadata(source: string): ScriptMetadata {
  if (Buffer.byteLength(source) > 8 * 1024 * 1024) throw new Error('Script exceeds 8 MiB');
  const header = source.replace(/^\uFEFF/, '').match(/^\s*\/\/\s*==UserScript==\s*\r?\n([\s\S]*?)^\s*\/\/\s*==\/UserScript==\s*$/m);
  if (!header) throw new Error('Missing complete ==UserScript== header');
  const raw: Record<string, string[]> = Object.create(null);
  for (const line of header[1].split(/\r?\n/)) {
    const m = line.match(/^\s*\/\/\s*@([\w:-]+)(?:\s+(.*?))?\s*$/);
    if (m) (raw[m[1].toLowerCase()] ??= []).push((m[2] ?? '').trim());
  }
  const first = (k: string) => raw[k]?.[0] ?? '';
  const list = (k: string) => [...new Set(raw[k] ?? [])];
  if (!first('name')) throw new Error('@name is required');
  if (first('run-at') && !runAts.includes(first('run-at'))) throw new Error('Unsupported @run-at: ' + first('run-at'));
  for (const key of ['sandbox', 'run-in', 'webrequest', 'unwrap']) {
    if (Object.hasOwn(raw, key)) throw new Error('Unsupported execution directive @' + key);
  }
  const grants = list('grant');
  if (grants.some(g => !SUPPORTED_GRANTS.has(g))) throw new Error('Unsupported @grant: ' + grants.filter(g => !SUPPORTED_GRANTS.has(g)).join(', '));
  if (grants.includes('none') && grants.length > 1) throw new Error('@grant none cannot be combined with other grants');
  for (const pattern of [...list('match'), ...list('exclude-match')]) {
    if (pattern !== '<all_urls>' && !/^(\*|http|https):\/\/(\*|\*\.[^/*:]+|[^/*:]+)\/.*$/i.test(pattern))
      throw new Error('Unsupported @match pattern: ' + pattern + ' (only HTTP(S), no port patterns)');
  }
  for (const pattern of [...list('include'), ...list('exclude')]) {
    if (pattern.startsWith('/') && pattern.endsWith('/')) new RegExp(pattern.slice(1, -1));
  }
  const resources = list('resource').map(value => {
    const m = value.match(/^(\S+)\s+(\S+)$/);
    if (!m) throw new Error('Invalid @resource: ' + value);
    return { name: m[1], url: m[2] };
  });
  if (new Set(resources.map(r => r.name)).size !== resources.length) throw new Error('Duplicate @resource name');
  if (resources.length + list('require').length > 32) throw new Error('At most 32 @require/@resource assets');
  return { name: first('name'), namespace: first('namespace'), version: first('version'),
    description: first('description'), matches: list('match'), includes: list('include'),
    excludes: list('exclude'), excludeMatches: list('exclude-match'), grants,
    connects: list('connect'), requires: list('require'), resources,
    runAt: (first('run-at') || 'document-idle') as ScriptMetadata['runAt'],
    noframes: Object.hasOwn(raw, 'noframes'), raw };
}
const glob = (s: string) => new RegExp('^' + s.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
function matchPattern(url: URL, rule: string): boolean {
  if (rule === '<all_urls>') return /^https?:$/.test(url.protocol);
  const m = rule.match(/^(\*|http|https):\/\/([^/]+)(\/.*)$/i);
  if (!m || (m[1] !== '*' && m[1].toLowerCase() + ':' !== url.protocol)) return false;
  const host = m[2].toLowerCase();
  if (host !== '*' && !(host.startsWith('*.') ? url.hostname === host.slice(2) || url.hostname.endsWith(host.slice(1)) : url.hostname === host)) return false;
  return glob(m[3]).test(url.pathname + url.search); // fragments do not participate in @match
}
function include(href: string, rule: string) {
  return rule.startsWith('/') && rule.endsWith('/') ? new RegExp(rule.slice(1, -1)).test(href) : glob(rule).test(href);
}
export function matches(urlText: string, m: ScriptMetadata) {
  try {
    const url = new URL(urlText);
    return /^https?:$/.test(url.protocol) &&
      (m.matches.some(r => matchPattern(url, r)) || m.includes.some(r => include(url.href, r))) &&
      !m.excludeMatches.some(r => matchPattern(url, r)) && !m.excludes.some(r => include(url.href, r));
  } catch { return false; }
}
export function connectAllowed(target: string, page: string, rules: string[]) {
  const u = new URL(target), p = new URL(page);
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return false;
  if (u.origin === p.origin) return true;
  return rules.some(r => {
    const host = r.toLowerCase().replace(/^\*\./, '');
    return r === '*' || (r === 'self' ? u.hostname === p.hostname : u.hostname === host || u.hostname.endsWith('.' + host));
  });
}
export const identity = (m: ScriptMetadata) => m.namespace + '\n' + m.name;
export const pageWorld = (m: ScriptMetadata) => !m.grants.length || m.grants.includes('none') || m.grants.includes('unsafeWindow');
export function needsApproval(old: ScriptRecord['approved'], next: ScriptMetadata) {
  const rules = old.rules ?? { matches: [], includes: [], excludes: [], excludeMatches: [] };
  return next.grants.some(g => !old.grants.includes(g)) || next.connects.some(c => !old.connects.includes(c)) || (pageWorld(next) && !old.pageWorld) ||
    next.matches.some(r => !rules.matches.includes(r)) || next.includes.some(r => !rules.includes.includes(r)) ||
    rules.excludes.some(r => !next.excludes.includes(r)) || rules.excludeMatches.some(r => !next.excludeMatches.includes(r));
}
/** Numeric dotted components plus natural prerelease ordering; never locale-dependent. */
export function compareVersions(a: string, b: string): number {
  const parts = (s: string) => s.replace(/^v/i, '').split('+')[0].toLowerCase().match(/\d+|[a-z]+/g) ?? [];
  const aa = parts(a), bb = parts(b);
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
    const x = aa[i], y = bb[i];
    if (x === y) continue;
    if (x === undefined) { if (/^\d+$/.test(y)) { if (BigInt(y) === 0n) continue; return -1; } return 1; }
    if (y === undefined) { if (/^\d+$/.test(x)) { if (BigInt(x) === 0n) continue; return 1; } return -1; }
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
    if (nx && ny) { const n = BigInt(x) - BigInt(y); if (n) return n > 0n ? 1 : -1; }
    else if (nx !== ny) return nx ? 1 : -1;
    else return x < y ? -1 : 1;
  }
  return 0;
}
