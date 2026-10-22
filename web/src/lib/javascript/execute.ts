const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as
  new (...parameters: string[]) => (...values: unknown[]) => Promise<unknown>;

/** Shared trusted compiler for note blocks, user commands and template callers. */
export function compileJavascript(source: string, parameters: readonly string[], sourceURL: string): (...values: unknown[]) => Promise<unknown> {
  const url = sourceURL.replace(/[\r\n\u2028\u2029]/g, '');
  return new AsyncFunction(...parameters, `"use strict";\n${source}\n//# sourceURL=${url}`);
}
