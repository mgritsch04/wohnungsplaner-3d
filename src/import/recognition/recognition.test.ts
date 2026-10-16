import { describe, expect, it } from 'vitest';
import { detectRasterWalls, otsuThreshold } from './raster';
import { detectVectorWalls } from './vector';

/** 100 px = 1 m; room 5 × 4 m (centerlines), 20 cm walls, 1 m door gap in the bottom wall. */
function synthetic(opts: { door?: boolean } = {}) {
  const W = 700;
  const H = 600;
  const gray = new Uint8ClampedArray(W * H).fill(255);
  const t = 10;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const inH = (yy: number) => Math.abs(y - yy) <= t && x >= 100 - t && x <= 600 + t;
      const inV = (xx: number) => Math.abs(x - xx) <= t && y >= 100 - t && y <= 500 + t;
      const door = opts.door !== false && Math.abs(y - 500) <= t && x >= 250 && x <= 350;
      if (inH(100) || (inH(500) && !door) || inV(100) || inV(600)) gray[y * W + x] = 20;
    }
  return { width: W, height: H, gray, metersPerPixel: 0.01 };
}

describe('raster recognition', () => {
  it('computes an Otsu threshold between the two intensity classes', () => {
    const t = otsuThreshold(synthetic().gray);
    expect(t).toBeGreaterThanOrEqual(20);
    expect(t).toBeLessThan(255);
  });

  it('detects the four walls and the door gap of a simple room', () => {
    const out = detectRasterWalls(synthetic());
    expect(out.walls.length).toBe(4);
    for (const w of out.walls) expect(w.thickness).toBeGreaterThan(18);
    for (const w of out.walls) expect(w.thickness).toBeLessThan(23);
    // corners meet at the centerline intersections
    const ends = out.walls.flatMap((w) => [w.a, w.b]);
    const near = (x: number, y: number) => ends.filter((p) => Math.abs(p.x - x) < 2 && Math.abs(p.y - y) < 2).length;
    expect(near(100, 100)).toBe(2);
    expect(near(600, 500)).toBe(2);
    expect(out.openings).toHaveLength(1);
    expect(out.openings[0].width).toBeGreaterThan(95);
    expect(out.openings[0].width).toBeLessThan(105);
    expect(out.openings[0].center.x).toBeCloseTo(300, -1);
  });
});

describe('vector recognition', () => {
  it('pairs parallel lines into walls', () => {
    const seg = (x1: number, y1: number, x2: number, y2: number) => ({ x1, y1, x2, y2 });
    // outer and inner outline of a 5 × 4 m room with 20 cm walls (100 px = 1 m)
    const segments = [
      seg(90, 90, 610, 90),
      seg(110, 110, 590, 110),
      seg(90, 510, 610, 510),
      seg(110, 490, 590, 490),
      seg(90, 90, 90, 510),
      seg(110, 110, 110, 490),
      seg(610, 90, 610, 510),
      seg(590, 110, 590, 490),
    ];
    const out = detectVectorWalls(segments, 0.01);
    expect(out.walls.length).toBe(4);
    for (const w of out.walls) expect(w.thickness).toBeCloseTo(20, 5);
  });

  it('finds a door gap even if the two wall pieces differ by rounding noise', () => {
    const seg = (x1: number, y1: number, x2: number, y2: number) => ({ x1, y1, x2, y2 });
    const e = 0.004; // PDF coordinates are rounded – the right piece lies a tiny bit higher
    const segments = [
      seg(90, 90, 250, 90), seg(350, 90 - e, 610, 90 - e), seg(110, 110, 250, 110), seg(350, 110 - e, 590, 110 - e),
      seg(90, 510, 610, 510), seg(110, 490, 590, 490), seg(90, 90, 90, 510), seg(110, 110, 110, 490), seg(610, 90, 610, 510), seg(590, 110, 590, 490),
    ];
    const out = detectVectorWalls(segments, 0.01);
    expect(out.walls).toHaveLength(4);
    expect(out.openings).toHaveLength(1);
    expect(out.openings[0].width).toBeCloseTo(100, 1);
  });
});
