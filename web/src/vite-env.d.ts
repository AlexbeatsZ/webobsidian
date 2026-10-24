/// <reference types="vite/client" />
declare const __MATHJAX_VERSION__: string;
declare const __APP_VERSION__: string;

// PixiJS ships the unsafe-eval plugin without a `types` export condition, so TS
// cannot resolve declarations for the subpath. It's a side-effect-only module.
declare module 'pixi.js/unsafe-eval';
