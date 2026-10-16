import { describe, expect, it } from 'vitest';
import { isAreaTone } from './areaTone';
import { wallCandidateSegments } from './recognition/recognizers';

describe('area fills vs. wall fills (#114)', () => {
  it('treats light room fills as area tones; black, dark grey and red walls not', () => {
    for (const c of ['#faedc7', '#cce5fa', '#d1f2d9', '#ffffff', '#f0f0f0']) expect(isAreaTone(c), c).toBe(true);
    for (const c of ['#000000', '#404040', '#595959', '#333333', '#e00000', '#c03030']) expect(isAreaTone(c), c).toBe(false);
    expect(isAreaTone('not a colour')).toBe(false);
  });

  it('drops area-fill edges; with solid dark wall fills only their outlines count', () => {
    const segs = [
      { x1: 0, y1: 0, x2: 10, y2: 0 },
      { x1: 0, y1: 5, x2: 10, y2: 5, areaFill: true },
      { x1: 0, y1: 9, x2: 10, y2: 9, areaFill: false },
    ];
    expect(wallCandidateSegments(segs, 0.01).map((s) => s.y1)).toEqual([0, 9]);
    // 4 × 2 m of dark fill outline at 1 cm/px = 8 m ≥ threshold → only the fills are used
    const fill = [0, 20, 40, 60].map((y) => ({ x1: 0, y1: y, x2: 200, y2: y, darkFill: true }));
    expect(wallCandidateSegments([...segs, ...fill], 0.01)).toEqual(fill);
    // a few small dark fills (arrow heads) do not switch the mode
    const arrows = [{ x1: 0, y1: 0, x2: 10, y2: 0, darkFill: true }];
    expect(wallCandidateSegments([...segs, ...arrows], 0.01)).toHaveLength(3);
  });
});
