import { describe, expect, it } from 'vitest';
import { clipSegment, insideClip, type ClipArea } from './clipPath';

const rect = (x0: number, y0: number, x1: number, y1: number): ClipArea => [
  [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ],
];
const P = (x: number, y: number) => ({ x, y });

describe('PDF clipping paths (#214)', () => {
  const view = rect(0, 0, 100, 100);

  it('keeps lines inside, drops lines outside and cuts lines crossing the border', () => {
    expect(clipSegment(P(10, 10), P(90, 10), [view])).toEqual([[P(10, 10), P(90, 10)]]);
    expect(clipSegment(P(150, 10), P(250, 10), [view])).toEqual([]);
    const [[a, b]] = clipSegment(P(50, 50), P(250, 50), [view]);
    expect(a).toEqual(P(50, 50));
    expect(b.x).toBeCloseTo(100, 6);
  });

  it('keeps lines on or just outside the border (viewport ending inside a wall)', () => {
    expect(clipSegment(P(100, 10), P(100, 90), [view])).toHaveLength(1);
    expect(clipSegment(P(105, 10), P(105, 90), [view], 8)).toHaveLength(1);
    expect(clipSegment(P(120, 10), P(120, 90), [view], 8)).toHaveLength(0);
  });

  it('applies nested clips together and an L-shaped viewport', () => {
    expect(clipSegment(P(10, 10), P(90, 10), [view, rect(50, 0, 200, 200)])).toEqual([[P(50, 10), P(90, 10)]]);
    const l: ClipArea = [[P(0, 0), P(100, 0), P(100, 50), P(50, 50), P(50, 100), P(0, 100)]];
    expect(insideClip(P(75, 75), l)).toBe(false);
    expect(insideClip(P(25, 75), l)).toBe(true);
    const pieces = clipSegment(P(10, 75), P(90, 75), [l]);
    expect(pieces).toHaveLength(1);
    expect(pieces[0][1].x).toBeCloseTo(50, 6);
  });
});
