import { getDocument, GlobalWorkerOptions, TextLayer } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { DocumentInitParameters } from 'pdfjs-dist/types/src/display/api';

GlobalWorkerOptions.workerSrc = workerUrl;

export function loadPdf(options: DocumentInitParameters) {
  const base = new URL(`${import.meta.env.BASE_URL}pdfjs-assets/`, document.baseURI).href;
  return getDocument({ ...options, enableXfa: false, useWorkerFetch: true,
    cMapUrl: base + 'cmaps/', cMapPacked: true, standardFontDataUrl: base + 'standard_fonts/',
    wasmUrl: base + 'wasm/', iccUrl: base + 'iccs/',
    disableStream: true, disableAutoFetch: true, useSystemFonts: true });
}
export { TextLayer };
