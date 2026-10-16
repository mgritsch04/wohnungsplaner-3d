import { describe, expect, it } from 'vitest';
import { createLookFilter, LOOK_MAX_STEP } from './lookFilter';

/** Sum of the accepted horizontal deltas. */
function run(events: number[], reset = false) {
  const f = createLookFilter();
  if (reset) f.reset();
  let sum = 0;
  for (const dx of events) sum += f.next(dx, 0)?.[0] ?? 0;
  return sum;
}

describe('look filter (#142)', () => {
  it('passes normal slow and medium mouse motion unchanged', () => {
    const slow = Array.from({ length: 50 }, () => 3);
    expect(run(slow)).toBe(150);
    expect(run([100, 100, 100])).toBe(300);
  });

  it('drops a single spike in the middle of slow motion (the ~180° jump)', () => {
    const events = [4, 5, 3, 4, 1400, 4, 5];
    expect(run(events)).toBe(25);
    expect(run([4, 5, -1350, 4])).toBe(13);
  });

  it('keeps a real fast move: the second large event in a row is accepted', () => {
    expect(run([5, 5, 300, 320, 340])).toBe(5 + 5 + 320 + 340);
  });

  it('never applies a single event beyond the hard limit', () => {
    expect(run([LOOK_MAX_STEP + 1, LOOK_MAX_STEP + 1])).toBe(0);
  });

  it('ignores a large first event after the pointer lock is gained, but not a small one', () => {
    expect(run([900, 4, 4], true)).toBe(8);
    expect(run([4, 4], true)).toBe(8);
  });

  it('ignores invalid values', () => {
    const f = createLookFilter();
    expect(f.next(Number.NaN, 0)).toBeNull();
    expect(f.next(0, Number.POSITIVE_INFINITY)).toBeNull();
  });
});
