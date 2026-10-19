/** Version and asset directory come from the installed, lockfile-pinned package. */
const assetPath = `${import.meta.env.BASE_URL}assets/mathjax-${__MATHJAX_VERSION__}`;
interface MathOptions { display: boolean; em: number; ex: number; containerWidth: number }

interface MathJaxRuntime {
  version: string;
  startup: { promise: Promise<void> };
  tex2svgPromise: (tex: string, options: MathOptions) => Promise<HTMLElement>;
  tex2svg?: (tex: string, options: MathOptions) => HTMLElement;
  svgStylesheet: () => HTMLStyleElement;
}

type MathJaxWindow = Window & { MathJax?: MathJaxRuntime | Record<string, unknown> };
let runtime: Promise<MathJaxRuntime> | undefined;
let retryAfter = 0;
let revision = 0;
let svgInstance = 0;
let queue: Promise<unknown> = Promise.resolve();
let yieldAt = 0;
const converters = new WeakMap<MathJaxRuntime, MathJaxRuntime['tex2svgPromise']>();
const cache = new Map<string, HTMLElement>();
const pending = new Map<string, { promise: Promise<HTMLElement | null>; signals: Set<AbortSignal> }>();
const CACHE_LIMIT = 256;
// Definitions have persistent TeX state: do not reuse their output or results
// from before a preamble change. External plugin conversions invalidate too.
const changesDefinitions = /\\(?:[gex]?def|let|global|(?:re|provide|new)command|(?:re|new)environment|DeclareMathOperator|require)\b/;
function invalidate() { revision++; cache.clear(); }

export function loadMathJax(): Promise<MathJaxRuntime> {
  if (runtime && (!retryAfter || Date.now() < retryAfter)) return runtime;
  retryAfter = 0;
  runtime = new Promise<MathJaxRuntime>((resolve, reject) => {
    const owner = window as MathJaxWindow;
    // Give the loader and lazy font/extension loaders a fully resolved web URL.
    const assetRoot = new URL(assetPath, document.baseURI).href;
    owner.MathJax = {
      loader: {
        paths: { mathjax: assetRoot, fonts: `${assetRoot}/fonts` },
        load: ['input/tex', 'output/svg', 'ui/safe'],
        failed: (error: { message: string }) => reject(new Error(error.message)),
      },
      startup: { typeset: false },
      tex: { tags: 'none' },
      svg: { font: 'mathjax-newcm', fontCache: 'local', fontPath: '[fonts]/%%FONT%%' },
      options: {
        // Widgets own conversion/lifecycle; no page scanner, menu or speech worker.
        safeOptions: { safeProtocols: { http: true, https: true, file: false, javascript: false, data: false } },
      },
    };
    const script = document.createElement('script');
    script.src = `${assetRoot}/startup.js`;
    script.async = true;
    script.onload = () => {
      const loaded = owner.MathJax as MathJaxRuntime;
      if (!loaded.startup?.promise) { reject(new Error('MathJax did not initialize')); return; }
      void loaded.startup.promise.then(() => {
        if (loaded.version !== __MATHJAX_VERSION__) throw new Error('Unexpected MathJax version');
        const convert = loaded.tex2svgPromise.bind(loaded);
        converters.set(loaded, convert);
        // Preamble plugins also access window.MathJax directly. Keep the public
        // API, but invalidate cached SVGs whenever they use the TeX processor.
        loaded.tex2svgPromise = async (tex, options) => {
          invalidate();
          try { return await convert(tex, options); } finally { invalidate(); }
        };
        if (loaded.tex2svg) {
          const sync = loaded.tex2svg.bind(loaded);
          loaded.tex2svg = (tex, options) => {
            invalidate();
            try { return sync(tex, options); } finally { invalidate(); }
          };
        }
        resolve(loaded);
      }).catch(reject);
    };
    script.onerror = () => { script.remove(); reject(new Error(`Could not load MathJax from ${script.src}`)); };
    document.head.appendChild(script);
  }).catch(error => {
    // Hundreds of formulas must share a failed load, not repeatedly load scripts.
    retryAfter = Date.now() + 5000;
    throw error;
  });
  return runtime;
}

async function convertFormula(mathjax: MathJaxRuntime, tex: string, options: MathOptions, signal: AbortSignal) {
  const definition = changesDefinitions.test(tex);
  if (definition) invalidate();
  const generation = revision;
  const key = JSON.stringify([generation, tex, options.display, options.em, options.containerWidth]);
  const cached = !definition && cache.get(key);
  if (cached) { cache.delete(key); cache.set(key, cached); return cached; }
  let job = !definition ? pending.get(key) : undefined;
  if (!job) {
    const signals = new Set<AbortSignal>();
    const promise = queue.then(async () => {
      if (![...signals].some(s => !s.aborted)) return null;
      // Yield at a short time budget, not one clamped timer per formula: cached
      // fonts can make many simple conversions fit in the same responsive batch.
      if (performance.now() >= yieldAt) {
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        yieldAt = performance.now() + 8;
      }
      if (![...signals].some(s => !s.aborted)) return null;
      let output: HTMLElement;
      try { output = await converters.get(mathjax)!(tex, options); }
      finally { if (definition) invalidate(); }
      if (!definition && generation === revision) {
        cache.set(key, output);
        while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
      }
      return output;
    });
    queue = promise.catch(() => {});
    job = { promise, signals };
    if (!definition) {
      const current = job;
      pending.set(key, current);
      const clear = () => { if (pending.get(key) === current) pending.delete(key); };
      void promise.then(clear, clear);
    }
  }
  job.signals.add(signal);
  try { return await job.promise; } finally { job.signals.delete(signal); }
}

/** Each cached clone needs its own local glyph IDs, including in print documents. */
function cloneOutput(template: HTMLElement, doc: Document): HTMLElement {
  const output = doc.importNode(template, true);
  const ids = new Map<string, string>();
  const prefix = `wo-math-${++svgInstance}-`;
  for (const node of output.querySelectorAll('[id]')) {
    const id = node.id; ids.set(id, prefix + id); node.id = prefix + id;
  }
  for (const node of output.querySelectorAll('*')) {
    for (const attr of [...node.attributes]) {
      const target = attr.value.startsWith('#') && ids.get(attr.value.slice(1));
      const value = target ? '#' + target : attr.value.replace(/url\(#([^)]*)\)/g,
        (raw, id: string) => ids.has(id) ? `url(#${ids.get(id)})` : raw);
      if (value !== attr.value) node.setAttributeNS(attr.namespaceURI, attr.name, value);
    }
  }
  return output;
}

/** Convert once per formula/layout/preamble and reuse SVG across editor remounts. */
export async function renderMath(body: HTMLElement, tex: string, display: boolean, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  const mathjax = await loadMathJax();
  if (signal.aborted) return;
  const doc = body.ownerDocument;
  const em = parseFloat(doc.defaultView!.getComputedStyle(body).fontSize) || 18;
  const template = await convertFormula(mathjax, tex, {
    display, em, ex: em / 2, containerWidth: body.closest('.cm-content')?.clientWidth || 720,
  }, signal);
  if (signal.aborted || !template) return;
  // Print uses a separate document; stylesheet and SVG must travel together.
  if (!doc.getElementById('MJX-SVG-styles')) doc.head.appendChild(doc.importNode(mathjax.svgStylesheet(), true));
  const output = cloneOutput(template, doc);
  output.setAttribute('data-mathjax-version', mathjax.version);
  output.setAttribute('aria-label', tex);
  body.replaceChildren(output);
}
