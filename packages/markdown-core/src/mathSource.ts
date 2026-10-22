import type { MathRegion } from './math.js';

/** Project existing source segments into TeX; quote prefixes never become formula text. */
export function mathBodyOffset(region: MathRegion, sourceOffset: number): number {
  let offset = 0;
  for (let i = 0; i < region.segments.length; i++) {
    const part = region.segments[i];
    if (sourceOffset <= part.to) return offset + Math.max(0, Math.min(part.to - part.from, sourceOffset - part.from));
    offset += part.to - part.from + (i < region.segments.length - 1 ? 1 : 0);
  }
  return offset;
}
