import { describe, it, expect } from 'vitest';
import { lineLocalTrigger } from './matching';
describe('snippet matching windows', () => {
  it('proves local bounded and unbounded patterns without changing their semantics', () => {
    expect(lineLocalTrigger(/(?:([A-Za-z])(\d+))$/)).toBe(true);
    expect(lineLocalTrigger(/(?:\\(sin|cos))$/)).toBe(true);
    expect(lineLocalTrigger(/(?:[\s\S]+)$/)).toBe(false);
    expect(lineLocalTrigger(/(?:[^x]+)$/)).toBe(false);
    expect(lineLocalTrigger(/(?:^mk)$/)).toBe(false);
    expect(lineLocalTrigger(/(?:mk)$/m)).toBe(false);
    expect(lineLocalTrigger(/(?:.*)$/s)).toBe(false);
    expect(lineLocalTrigger(/(?:(a)\1)$/)).toBe(false);
  });
});
