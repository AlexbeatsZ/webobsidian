/** Pure package/configuration data shared by the client, persistence and asset build. */
export type MathArgument = 'math' | 'text' | 'literal' | 'chemistry' | 'unit';
export interface MathCommandInfo { arguments?: readonly MathArgument[]; description?: string }
export interface MathPackage {
  id: string;
  name: string;
  component: string;
  requires?: readonly string[];
  conflicts?: readonly string[];
  commands?: Readonly<Record<string, MathCommandInfo>>;
  stateCommands?: readonly string[];
  /** Structured-cloneable context state which macro grouping does not restore. */
  state?: { options?: readonly string[]; data?: readonly string[] };
}
export const MATHJAX_PACKAGE_VERSION = '4.1.3';
export const SIUNITX_REVISION = 'ee9f3dc890c13e5e165122bfa7a181680634e183';
export const mathPackages: readonly MathPackage[] = [
  { id: 'mathtools', name: 'Mathtools · 数学排版', component: '[tex]/mathtools',
    stateCommands: ['DeclarePairedDelimiter', 'DeclarePairedDelimiterX', 'DeclarePairedDelimiterXPP'] },
  { id: 'mhchem', name: 'mhchem · 化学式与反应', component: '[tex]/mhchem', commands: {
    ce: { arguments: ['chemistry'] }, pu: { arguments: ['unit'] },
  } },
  { id: 'bussproofs', name: 'Bussproofs · 证明树', component: '[tex]/bussproofs' },
  { id: 'cancel', name: 'Cancel · 取消线', component: '[tex]/cancel' },
  { id: 'color', name: 'Color · 颜色', component: '[tex]/color',
    stateCommands: ['definecolor'], state: { data: ['color.model.userColors'] } },
  { id: 'boldsymbol', name: 'Boldsymbol · 粗体符号', component: '[tex]/boldsymbol' },
  { id: 'braket', name: 'Braket · Dirac 符号', component: '[tex]/braket', conflicts: ['physics'] },
  { id: 'bbox', name: 'Bbox · 公式边框', component: '[tex]/bbox' },
  { id: 'enclose', name: 'Enclose · 标记与框线', component: '[tex]/enclose' },
  { id: 'unicode', name: 'Unicode · 字符', component: '[tex]/unicode' },
  { id: 'extpfeil', name: 'Extpfeil · 扩展箭头', component: '[tex]/extpfeil' },
  { id: 'html', name: 'HTML · 公式类名与链接', component: '[tex]/html' },
  { id: 'gensymb', name: 'Gensymb · 物理符号', component: '[tex]/gensymb' },
  { id: 'physics', name: 'Physics · 物理（重定义 dd、qty 等命令）', component: '[tex]/physics', conflicts: ['braket', 'siunitx'] },
  { id: 'siunitx', name: 'siunitx · 数值与单位（第三方部分实现）', component: '[webobsidian]/siunitx.js',
    requires: ['html', 'gensymb', 'color', 'cancel'], conflicts: ['physics'],
    stateCommands: ['sisetup', 'DeclareSIUnit'], state: { options: ['siunitx'], data: ['siunitx'] }, commands: {
      num: { arguments: ['literal'] }, ang: { arguments: ['literal'] },
      unit: { arguments: ['unit'] }, qty: { arguments: ['literal', 'unit'] },
      numlist: { arguments: ['literal'] }, numrange: { arguments: ['literal', 'literal'] },
      qtylist: { arguments: ['literal', 'unit'] }, qtyrange: { arguments: ['literal', 'literal', 'unit'] },
      complexnum: { arguments: ['literal'] }, complexqty: { arguments: ['literal', 'unit'] },
      numproduct: { arguments: ['literal'] }, qtyproduct: { arguments: ['literal', 'unit'] },
      sisetup: { arguments: ['literal'] }, DeclareSIUnit: { arguments: ['literal', 'unit'] },
    } },
];
export interface MathConfiguration {
  version: 1;
  packages: string[];
  packageOptions: Record<string, Record<string, unknown>>;
  preambleFile: string;
  preamble: string;
  migration: string;
}
export const defaultMathConfiguration = (): MathConfiguration => ({
  version: 1,
  packages: ['mathtools', 'mhchem', 'bussproofs', 'cancel', 'color', 'boldsymbol', 'braket', 'bbox', 'enclose', 'unicode', 'extpfeil', 'html'],
  packageOptions: {}, preambleFile: '', preamble: '', migration: 'native-math-v1',
});
export function resolveMathPackages(ids: readonly string[]): MathPackage[] {
  const result = new Map<string, MathPackage>();
  const visit = (id: string) => {
    if (result.has(id)) return;
    const entry = mathPackages.find(p => p.id === id);
    if (!entry) throw new Error(`Unknown MathJax package: ${id}`);
    result.set(id, entry);
    entry.requires?.forEach(visit);
  };
  ids.forEach(visit);
  for (const entry of result.values())
    for (const other of entry.conflicts ?? [])
      if (result.has(other)) throw new Error(`MathJax packages conflict: ${entry.id} / ${other}`);
  // Dependency registration order is deterministic and independent of checkbox order.
  return [...result.values()].sort((a, b) => a.id.localeCompare(b.id));
}
export function normalizeMathConfiguration(value?: Partial<MathConfiguration>): MathConfiguration {
  const defaults = defaultMathConfiguration();
  if (value?.version !== undefined && value.version !== 1) throw new Error('Unknown math configuration version');
  const packages = [...new Set(value?.packages ?? defaults.packages)];
  resolveMathPackages(packages);
  const preambleFile = (value?.preambleFile ?? '').trim().replaceAll('\\', '/');
  if (/^(?:\/|[A-Za-z]:|~)/.test(preambleFile) || preambleFile.split('/').some(p => p === '..' || p === '.'))
    throw new Error('Math preamble must use a Vault-relative path');
  const packageOptions = value?.packageOptions ?? {};
  for (const [id, options] of Object.entries(packageOptions)) {
    if (!mathPackages.some(p => p.id === id)) throw new Error(`Unknown math package options: ${id}`);
    if (!options || Array.isArray(options) || typeof options !== 'object') throw new Error(`Invalid options for ${id}`);
  }
  if (packageOptions.mathtools?.['allow-mathtoolsset'] === true)
    throw new Error('Use packageOptions.mathtools to configure mathtools; in-formula mathtoolsset is disabled');
  return { ...defaults, ...value, packages, preambleFile, packageOptions };
}

/** One authoritative argument classification; editor adapters project this data. */
export const mathTextCommands = [
  'text', 'textrm', 'textup', 'textit', 'textbf', 'textsf', 'texttt', 'textnormal',
  'clap', 'textllap', 'textrlap', 'textclap', 'hbox', 'mbox', 'fbox', 'framebox',
] as const;
export const mathBaseArguments: Readonly<Record<string, readonly MathArgument[]>> = {
  ...Object.fromEntries(mathTextCommands.map(name => [name, ['text'] as const])),
  colorbox: ['literal', 'text'], fcolorbox: ['literal', 'literal', 'text'],
  tag: ['literal'], begin: ['literal'], end: ['literal'], mmlToken: ['literal', 'literal'],
  unicode: ['literal'], textcolor: ['literal', 'math'], color: ['literal'], style: ['literal', 'math'],
  operatorname: ['literal'], label: ['literal'], ref: ['literal'], eqref: ['literal'],
};
export function mathArgumentInfo(ids: readonly string[]): Record<string, readonly MathArgument[]> {
  const result = { ...mathBaseArguments };
  for (const entry of resolveMathPackages(ids))
    for (const [name, info] of Object.entries(entry.commands ?? {}))
      if (info.arguments) result[name] = info.arguments;
  return result;
}
