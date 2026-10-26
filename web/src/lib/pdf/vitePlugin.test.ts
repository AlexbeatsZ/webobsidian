import { expect, it } from 'vitest';
import { pdfAssetFiles, pdfAssetsPlugin } from './vitePlugin';

it('emits actual official CMaps/fonts/wasm/ICC and decoder fallbacks without a script sandbox', async () => {
  const files = await pdfAssetFiles();
  expect(files.has('cmaps/UniGB-UTF16-H.bcmap')).toBe(true);
  expect(files.has('standard_fonts/LiberationSans-Regular.ttf')).toBe(true);
  expect(files.has('standard_fonts/FoxitSerif.pfb')).toBe(true);
  expect(files.has('wasm/openjpeg.wasm')).toBe(true);
  expect(files.has('wasm/jbig2.wasm')).toBe(true);
  expect(files.has('wasm/qcms_bg.wasm')).toBe(true);
  expect(files.has('iccs/CGATS001Compat-v2-micro.icc')).toBe(true);
  expect(files.has('wasm/openjpeg_nowasm_fallback.js')).toBe(true);
  expect(files.has('wasm/jbig2_nowasm_fallback.js')).toBe(true);
  expect([...files.keys()].some(name => name.includes('quickjs'))).toBe(false);
  const emitted: { fileName: string; source: Uint8Array }[] = [];
  const hook = pdfAssetsPlugin().generateBundle;
  const generate = typeof hook === 'function' ? hook : hook!.handler;
  await generate.call({ emitFile: (asset: { fileName: string; source: Uint8Array }) => emitted.push(asset) } as any, {} as any, {} as any, false);
  expect(emitted).toHaveLength(files.size);
  expect(emitted.every(asset => asset.fileName.startsWith('pdfjs-assets/') && asset.source.byteLength > 0)).toBe(true);
});
