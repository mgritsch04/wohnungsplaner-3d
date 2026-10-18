import { describe, expect, it } from 'vitest';
import { BOB_DEPTH, createBob, stepBob } from './headBob';

describe('head bob while walking (#263)', () => {
  it('dips by at most a centimetre while walking and settles when standing still', () => {
    const s = createBob();
    let min = 0;
    for (let i = 0; i < 120; i++) min = Math.min(min, stepBob(s, 1.4 / 60, 1 / 60));
    expect(min).toBeLessThan(-BOB_DEPTH / 2);
    expect(min).toBeGreaterThanOrEqual(-BOB_DEPTH - 1e-9);
    let last = 0;
    for (let i = 0; i < 120; i++) last = stepBob(s, 0, 1 / 60);
    expect(Math.abs(last)).toBeLessThan(1e-3);
  });

  it('does not move the head without walking', () => {
    const s = createBob();
    for (let i = 0; i < 60; i++) expect(Math.abs(stepBob(s, 0, 1 / 60))).toBe(0);
  });
});
