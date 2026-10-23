import { describe, expect, it } from 'vitest';
import { flatScore, hasSevere, passes, roomScore } from './score';
import type { Severity } from './types';

const f = (...s: Severity[]) => s.map((severity) => ({ severity }));

describe('walk-through points', () => {
  it('take 25 per severe, 8 per medium and 2 per light finding, not below 0', () => {
    expect(roomScore([])).toBe(100);
    expect(roomScore(f('M', 'L', 'L'))).toBe(88);
    expect(roomScore(f('S', 'S', 'S', 'S', 'S'))).toBe(0);
  });

  it('pass a room without severe findings and with at least 85 points', () => {
    expect(passes(f('M', 'L', 'L'))).toBe(true);
    expect(passes(f('M', 'M'))).toBe(false);
    expect(passes(f('S'))).toBe(false);
    expect(hasSevere(f('L', 'S'))).toBe(true);
  });

  it('sum up a flat as mean and lowest room', () => {
    expect(flatScore([{ score: 100 }, { score: 84 }, { score: 92 }])).toEqual({ score: 92, minScore: 84 });
    expect(flatScore([])).toEqual({ score: 100, minScore: 100 });
  });
});
