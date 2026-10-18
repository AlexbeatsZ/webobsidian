/** Version and asset directory come from the installed, lockfile-pinned package. */
const assetRoot = `${import.meta.env.BASE_URL}assets/mathjax-${__MATHJAX_VERSION__}`;

interface MathJaxRuntime {
  version: string;
  startup: { promise: Promise<void> };
  tex2svgPromise: (tex: string, options: { display: boolean; em: number; ex: number; containerWidth: number }) => Promise<HTMLElement>;
  svgStylesheet: () => HTMLStyleElement;
}

type MathJaxWindow = Window & { MathJax?: MathJaxRuntime | Record<string, unknown> };
let runtime: Promise<MathJaxRuntime> | undefined;

export function loadMathJax(): Promise<MathJaxRuntime> {
  if (runtime) return runtime;
  runtime = new Promise<MathJaxRuntime>((resolve, reject) => {
    const owner = window as MathJaxWindow;
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
        resolve(loaded);
      }).catch(reject);
    };
    script.onerror = () => { script.remove(); reject(new Error('Could not load MathJax')); };
    document.head.appendChild(script);
  }).catch(error => { runtime = undefined; throw error; });
  return runtime;
}

/** Convert only this formula; local SVG definitions also survive print cloning. */
export async function renderMath(body: HTMLElement, tex: string, display: boolean, signal: AbortSignal): Promise<void> {
  const mathjax = await loadMathJax();
  if (signal.aborted) return;
  const doc = body.ownerDocument;
  const em = parseFloat(doc.defaultView!.getComputedStyle(body).fontSize) || 18;
  const output = await mathjax.tex2svgPromise(tex, {
    display, em, ex: em / 2, containerWidth: body.closest('.cm-content')?.clientWidth || 720,
  });
  if (signal.aborted) return;
  // Print uses a separate document; stylesheet and SVG must travel together.
  if (!doc.getElementById('MJX-SVG-styles')) doc.head.appendChild(doc.importNode(mathjax.svgStylesheet(), true));
  output.setAttribute('data-mathjax-version', mathjax.version);
  output.setAttribute('aria-label', tex);
  body.replaceChildren(doc.adoptNode(output));
}
