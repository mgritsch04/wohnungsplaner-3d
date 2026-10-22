import { describe, expect, it } from 'vitest';
import { setDim } from './scanDims';

const base = { w: 1, d: 0.5, h: 2 };

describe('setDim', () => {
  it('changes only one axis when not proportional', () => {
    expect(setDim(base, 'h', 1.8, false)).toEqual({ w: 1, d: 0.5, h: 1.8 });
  });
  it('scales the others with the same factor when proportional', () => {
    const r = setDim(base, 'w', 2, true);
    expect(r.w).toBe(2);
    expect(r.d).toBeCloseTo(1);
    expect(r.h).toBeCloseTo(4);
  });
  it('ignores invalid values', () => {
    expect(setDim(base, 'w', 0, true)).toBe(base);
    expect(setDim(base, 'w', NaN, false)).toBe(base);
  });
});
