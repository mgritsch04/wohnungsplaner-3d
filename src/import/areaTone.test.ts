import { describe, expect, it } from 'vitest';
import { isAreaTone } from './areaTone';
import { heavyLines, mainPlanOnly } from './recognition/recognizers';

describe('wall candidates in CAD plans (#114)', () => {
  it('treats light room fills as area tones; black, dark grey and red walls not', () => {
    for (const c of ['#faedc7', '#cce5fa', '#d1f2d9', '#ffffff', '#f0f0f0']) expect(isAreaTone(c), c).toBe(true);
    for (const c of ['#000000', '#404040', '#595959', '#333333', '#e00000', '#c03030']) expect(isAreaTone(c), c).toBe(false);
    expect(isAreaTone('not a colour')).toBe(false);
  });

  it('keeps only lines heavier than the most common pen, unless the plan uses one pen', () => {
    const line = (y: number, width: number) => ({ x1: 0, y1: y, x2: 100, y2: y, width });
    const thin = [1, 2, 3, 4, 5, 6].map((y) => line(y, 1));
    const heavy = [10, 20, 30, 40].map((y) => line(y, 2.5));
    const fill = { x1: 0, y1: 50, x2: 100, y2: 50, width: 0 };
    expect(heavyLines([...thin, ...heavy, fill])).toEqual([...heavy, fill]);
    expect(heavyLines(thin)).toEqual(thin);
    // too few heavy lines: keep everything
    expect(heavyLines([...thin, line(10, 2.5)])).toHaveLength(7);
  });

  it('keeps the connected floor plan and drops small separate overview plans', () => {
    const w = (ax: number, ay: number, bx: number, by: number) => ({ a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: 20, confidence: 0.7 });
    const plan = [w(0, 0, 1000, 0), w(1000, 0, 1000, 800), w(1000, 800, 0, 800), w(0, 800, 0, 0)];
    const overview = [w(3000, 0, 3200, 0), w(3200, 0, 3200, 150)];
    const openings = [
      { center: { x: 500, y: 0 }, width: 90, kind: 'door' as const, confidence: 0.5 },
      { center: { x: 3100, y: 0 }, width: 90, kind: 'door' as const, confidence: 0.5 },
    ];
    const out = mainPlanOnly({ walls: [...overview, ...plan], openings, threshold: 0 }, 0.01);
    expect(out.walls).toEqual(plan);
    expect(out.openings.map((o) => o.center.x)).toEqual([500]);
  });
});
