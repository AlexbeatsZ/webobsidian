/** Compatibility recognition only; ordinary JavaScript keeps native highlighting. */
const directive = /^(?:[\t ]*\r?\n)*[\t ]*\/\/\s*@obsidian-js(?:[\t ]+[^\r\n]*)?(?:\r?\n|$)/;
export function executableSource(source: string, dedicated = false): string | null {
  if (dedicated) return source;
  const match = directive.exec(source);
  return match ? source.slice(match[0].length) : null;
}
