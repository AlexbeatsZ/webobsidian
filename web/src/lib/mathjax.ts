import { defaultMathConfiguration, mathRegions, resolveMathPackages, type MarkdownModel } from '@webobsidian/markdown-core';
import type { MathProfile } from './mathPreamble';

const assetPath = `${import.meta.env.BASE_URL}assets/mathjax-${__MATHJAX_VERSION__}`;
interface MathOptions { display: boolean; em: number; ex: number; containerWidth: number }
interface MathDocument {
  convertPromise(tex: string, options?: Record<string, unknown>): Promise<HTMLElement>;
  done(): Promise<void>;
}
// Only this pinned-version adapter accesses MathJax's component constructors.
interface MathJaxRuntime {
  version: string;
  loader: { load(...components: string[]): Promise<unknown> };
  config: { options: Record<string, unknown> };
  startup: {
    promise: Promise<void>;
    constructors: Record<string, new (options: Record<string, unknown>) => any>;
    mathjax: { document(root: Document, options: Record<string, unknown>): MathDocument };
    getOutputJax(): any;
  };
  tex2svgPromise(tex: string, options: MathOptions): Promise<HTMLElement>;
  tex2svg?: (tex: string, options: MathOptions) => HTMLElement;
  svgStylesheet(): HTMLStyleElement;
}
interface Engine {
  profile: MathProfile; document: MathDocument; input: any;
  commands: ReadonlySet<string>;
  stylesheet(): HTMLStyleElement;
  resetPackageState(): void;
}
export interface MathRenderOptions { transient?: boolean; sourcePath?: string; definitions?: readonly string[] }
let runtime: Promise<MathJaxRuntime> | undefined;
let retryAfter = 0, revision = 0, svgInstance = 0, yieldAt = 0;
let queue: Promise<unknown> = Promise.resolve();
let active: MathProfile = { configuration: defaultMathConfiguration(), segments: [], key: 'default' };
let profileEngine: Engine | undefined;
const engines = new Map<string, Engine>();
const cache = new Map<string, HTMLElement>();
const pending = new Map<string, { promise: Promise<HTMLElement | null>; signals: Set<AbortSignal> }>();
const listeners = new Set<() => void>();
const CACHE_LIMIT = 256, CONTEXT_LIMIT = 16;
const outputStyles = new WeakMap<HTMLElement, HTMLStyleElement>();
let effectRevision = -1, effectPattern = /$^/, opaquePattern = /$^/;
export const subscribeMathConfiguration = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export const mathConfigurationRevision = () => revision;
const notify = () => { revision++; cache.clear(); listeners.forEach(fn => fn()); };

function refreshCommandPatterns() {
  if (effectRevision !== revision) {
    const packages = resolveMathPackages(active.configuration.packages);
    const commands = ['def', 'gdef', 'edef', 'xdef', 'let', 'global', 'newcommand', 'renewcommand',
      'providecommand', 'newenvironment', 'renewenvironment', 'DeclareMathOperator', 'require', 'label',
      ...packages.flatMap(p => p.stateCommands ?? [])];
    effectPattern = new RegExp('\\\\(?:' + commands.join('|') + ')\\b');
    const opaque = packages.flatMap(p => Object.entries(p.commands ?? {}).flatMap(([name, info]) =>
      info.arguments?.some(kind => kind === 'literal' || kind === 'chemistry' || kind === 'unit') ? [name] : []));
    opaquePattern = opaque.length ? new RegExp('\\\\(?:' + opaque.join('|') + ')\\b') : /$^/;
    effectRevision = revision;
  }
}
/** Conservative effects classification, not another TeX parser. */
export function hasMathDefinitions(tex: string): boolean {
  refreshCommandPatterns();
  return effectPattern.test(tex);
}
export function canDecorateMath(tex: string): boolean {
  refreshCommandPatterns();
  return !!profileEngine?.commands.has('\\class') && !effectPattern.test(tex) && !opaquePattern.test(tex);
}
const definitionContexts = new WeakMap<MarkdownModel, { revision: number; regions: { from: number; tex: string }[] }>();
export function mathDefinitionContext(model: MarkdownModel, formulaFrom: number): readonly string[] {
  let value = definitionContexts.get(model);
  if (!value || value.revision !== revision) {
    value = { revision, regions: mathRegions(model).filter(r => r.closed && hasMathDefinitions(r.tex)).map(r => ({ from: r.from, tex: r.tex })) };
    definitionContexts.set(model, value);
  }
  return value.regions.filter(r => r.from < formulaFrom).map(r => r.tex);
}

export function loadMathJax(): Promise<MathJaxRuntime> {
  if (runtime && (!retryAfter || Date.now() < retryAfter)) return runtime;
  retryAfter = 0;
  runtime = new Promise<MathJaxRuntime>((resolve, reject) => {
    const owner = window as Window & { MathJax?: unknown };
    const assetRoot = new URL(assetPath, document.baseURI).href;
    owner.MathJax = {
      loader: {
        paths: { mathjax: assetRoot, fonts: `${assetRoot}/fonts`, webobsidian: `${assetRoot}/native` },
        load: ['input/tex', 'output/svg', 'ui/safe', '[tex]/begingroup'],
        dependencies: { '[webobsidian]/siunitx.js': ['input/tex'] },
        failed: (error: { message: string }) => reject(new Error(error.message)),
      },
      startup: { typeset: false }, tex: { tags: 'none' },
      svg: { font: 'mathjax-newcm', fontCache: 'local', fontPath: '[fonts]/%%FONT%%' },
      options: { safeOptions: {
        safeProtocols: { http: true, https: true, file: false, javascript: false, data: false },
        classPattern: /^(?:mjx-[-a-zA-Z0-9_.]+|MathML-Unit)$/,
      } },
    };
    const script = document.createElement('script');
    script.src = `${assetRoot}/startup.js`; script.async = true;
    script.onload = () => {
      const loaded = owner.MathJax as MathJaxRuntime;
      if (!loaded.startup?.promise) { reject(new Error('MathJax did not initialize')); return; }
      void loaded.startup.promise.then(() => {
        if (loaded.version !== __MATHJAX_VERSION__) throw new Error('Unexpected MathJax version');
        // Legacy plugins retain an isolated compatibility processor. Native
        // preambles are imported once and never depend on its mutable state.
        resolve(loaded);
      }).catch(reject);
    };
    script.onerror = () => { script.remove(); reject(new Error(`Could not load MathJax from ${script.src}`)); };
    document.head.appendChild(script);
  }).catch(error => { retryAfter = Date.now() + 5000; throw error; });
  return runtime;
}
function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = queue.then(async () => {
    if (performance.now() >= yieldAt) {
      await new Promise<void>(resolve => setTimeout(resolve, 0)); yieldAt = performance.now() + 8;
    }
    return operation();
  });
  queue = result.catch(() => {}); return result;
}

async function createEngine(profile: MathProfile, definitions: readonly string[] = []): Promise<Engine> {
  const mathjax = await loadMathJax(), packages = resolveMathPackages(profile.configuration.packages);
  await mathjax.loader.load(...packages.map(p => p.component));
  const Input = mathjax.startup.constructors.tex;
  if (!Input || !mathjax.startup.mathjax?.document) throw new Error('MathJax context constructors unavailable');
  const input = new Input({
    packages: ['base', 'ams', 'newcommand', 'textmacros', 'configmacros', 'begingroup', 'require', ...packages.map(p => p.id)],
    require: { defaultAllow: false, allow: Object.fromEntries(packages.filter(p => p.component.startsWith('[tex]/')).map(p => [p.id, true])) },
    ...profile.configuration.packageOptions, tags: 'none',
    ...(packages.some(p => p.id === 'mathtools') ? { mathtools: { ...profile.configuration.packageOptions.mathtools, 'allow-mathtoolsset': false } } : {}),
    formatError: (jax: any, error: Error) => {
      const parser = jax.parseOptions.parser;
      const line = parser?.string?.slice(0, parser.i).split('\n').length;
      throw new Error(`${error.message}${line ? ` (line ${line})` : ''}`);
    },
  });
  const output = mathjax.startup.getOutputJax();
  const doc = mathjax.startup.mathjax.document(document, { ...mathjax.config.options, InputJax: input, OutputJax: output });
  try {
    for (const segment of profile.segments) {
      try { await doc.convertPromise(segment.tex, { display: false }); }
      catch (cause) { throw new Error(`${segment.source}: ${cause instanceof Error ? cause.message : String(cause)}`); }
    }
    for (const tex of definitions) await doc.convertPromise(tex, { display: false });
    // Freeze baseline definitions. Even gdef in a preview stays in its sandbox.
    await doc.convertPromise('\\begingroupSandbox', { display: false });
    const options = input.parseOptions.options;
    const optionState = new Map(packages.flatMap(p => (p.state?.options ?? []).map(key => [key, structuredClone(options[key])] as const)));
    const packageState = (path: string) => {
      const [key, ...parts] = path.split('.');
      if (!parts.length) return { get: () => input.parseOptions.packageData.get(key), set: (value: unknown) => input.parseOptions.packageData.set(key, value) };
      let parent = input.parseOptions.packageData.get(key);
      for (const part of parts.slice(0, -1)) parent = parent[part];
      const leaf = parts.at(-1)!;
      return { get: () => parent[leaf], set: (value: unknown) => { parent[leaf] = value; } };
    };
    const dataState = packages.flatMap(p => (p.state?.data ?? []).map(key => {
      const field = packageState(key); return { field, value: structuredClone(field.get()) };
    }));
    return {
      profile, document: doc, input, commands: new Set(engineCommandNames({ input })), stylesheet: () => output.styleSheet(doc),
      resetPackageState() {
        input.parseOptions.tags.reset();
        for (const [key, value] of optionState) options[key] = structuredClone(value);
        for (const { field, value } of dataState) field.set(structuredClone(value));
      },
    };
  } catch (error) { await doc.done(); throw error; }
}
export interface MathCandidate { commit(): void; dispose(): void; commands: string[] }
export async function validateMathProfile(profile: MathProfile): Promise<MathCandidate> {
  if (profile.key === active.key) return { commit() {}, dispose() {}, commands: mathCommandNames() };
  const engine = await enqueue(() => createEngine(profile));
  let committed = false;
  return { commands: [...engine.commands], dispose() { if (!committed) void enqueue(() => engine.document.done()); }, commit() {
    committed = true;
    active = profile;
    const old = new Set([...engines.values(), ...(profileEngine ? [profileEngine] : [])]);
    profileEngine = engine;
    engines.clear(); notify();
    void enqueue(async () => { for (const entry of old) if (entry !== engine) await entry.document.done(); });
  } };
}
export async function activateMathProfile(profile: MathProfile) { (await validateMathProfile(profile)).commit(); }

/** Once per configuration, not on the input hot path. Private map shape is version-pinned. */
export function mathCommandNames(): string[] {
  return profileEngine ? [...profileEngine.commands] : [];
}
function engineCommandNames(engine: Pick<Engine, 'input'>): string[] {
  const handler = engine.input.parseOptions.handlers.get('macro'), names = new Set<string>();
  for (const { item } of handler?._configuration ?? [])
    if (item.map instanceof Map) for (const name of item.map.keys()) names.add('\\' + name);
  return [...names].sort();
}
async function convertFormula(tex: string, options: MathOptions, signal: AbortSignal, render: MathRenderOptions) {
  const generation = revision, profile = active, definitions = render.definitions ?? [];
  const contextKey = JSON.stringify([profile.key, definitions]);
  const key = JSON.stringify([generation, contextKey, render.transient ?? false, tex, options.display, options.em, options.ex, options.containerWidth]);
  const definition = hasMathDefinitions(tex), cached = !definition && !render.transient && cache.get(key);
  if (cached) { cache.delete(key); cache.set(key, cached); return cached; }
  let job = !definition ? pending.get(key) : undefined;
  if (!job) {
    const signals = new Set<AbortSignal>();
    const promise = enqueue(async () => {
      if (generation !== revision || ![...signals].some(s => !s.aborted)) return null;
      let engine = definitions.length ? engines.get(contextKey) : profileEngine;
      if (!engine) {
        engine = await createEngine(profile, definitions);
        if (!definitions.length && profile === active) profileEngine = engine;
        else engines.set(contextKey, engine);
        while (engines.size > CONTEXT_LIMIT) {
          const first = engines.keys().next().value!, stale = engines.get(first)!;
          engines.delete(first); await stale.document.done();
        }
      } else if (definitions.length) { engines.delete(contextKey); engines.set(contextKey, engine); }
      if (generation !== revision || ![...signals].some(s => !s.aborted)) return null;
      engine.resetPackageState();
      const output = await engine.document.convertPromise('\\begingroupSandbox ' + tex, options as unknown as Record<string, unknown>);
      if (generation !== revision) return null;
      outputStyles.set(output, engine.stylesheet());
      if (!definition && !render.transient) {
        cache.set(key, output);
        while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
      }
      return output;
    });
    job = { promise, signals };
    if (!definition) {
      const current = job; pending.set(key, current);
      const clear = () => { if (pending.get(key) === current) pending.delete(key); };
      void promise.then(clear, clear);
    }
  }
  job.signals.add(signal);
  try { return await job.promise; } finally { job.signals.delete(signal); }
}
function cloneOutput(template: HTMLElement, doc: Document): HTMLElement {
  const output = doc.importNode(template, true), ids = new Map<string, string>(), prefix = `wo-math-${++svgInstance}-`;
  for (const node of output.querySelectorAll('[id]')) { const id = node.id; ids.set(id, prefix + id); node.id = prefix + id; }
  for (const node of output.querySelectorAll('*')) for (const attr of [...node.attributes]) {
    const target = attr.value.startsWith('#') && ids.get(attr.value.slice(1));
    const value = target ? '#' + target : attr.value.replace(/url\(#([^)]*)\)/g,
      (raw, id: string) => ids.has(id) ? `url(#${ids.get(id)})` : raw);
    if (value !== attr.value) node.setAttributeNS(attr.namespaceURI, attr.name, value);
  }
  return output;
}
export async function renderMath(body: HTMLElement, tex: string, display: boolean, signal: AbortSignal, options: MathRenderOptions = {}): Promise<void> {
  while (!signal.aborted) {
    const generation = revision, doc = body.ownerDocument;
    const em = parseFloat(doc.defaultView!.getComputedStyle(body).fontSize) || 18;
    const template = await convertFormula(tex, { display, em, ex: em / 2,
      containerWidth: body.closest('.cm-content')?.clientWidth || body.parentElement?.clientWidth || 720,
    }, signal, options);
    if (signal.aborted) return;
    if (generation !== revision) continue;
    if (!template) return;
    const stylesheet = outputStyles.get(template);
    if (stylesheet && !doc.getElementById('MJX-SVG-styles')) {
      const style = doc.importNode(stylesheet, true); style.id = 'MJX-SVG-styles'; doc.head.appendChild(style);
    }
    const output = cloneOutput(template, doc);
    output.setAttribute('data-mathjax-version', __MATHJAX_VERSION__);
    output.setAttribute('data-math-profile-revision', String(revision)); output.setAttribute('aria-label', tex);
    body.replaceChildren(output); return;
  }
}
