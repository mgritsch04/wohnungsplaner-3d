import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../../model/vec';
import { detectRasterWalls } from './raster';
import { doorArc, outlineSegments, renderSyntheticPlan } from './syntheticPlans';
import { detectVectorWalls, type VectorSegment } from './vector';

type W = { a: Vec2; b: Vec2; thickness: number };
const PX = 100; // 100 px = 1 m in all plans below
const px = (p: Vec2) => ({ x: p.x * PX, y: p.y * PX });
const near = (p: Vec2, q: Vec2, tol: number) => Math.hypot(p.x - q.x, p.y - q.y) <= tol;
/** The wall from p to q (plan metres) was found, with both ends within `tol` pixels. */
function findWall(walls: W[], p: Vec2, q: Vec2, tol = 2.5): W | undefined {
  const P = px(p);
  const Q = px(q);
  return walls.find((w) => (near(w.a, P, tol) && near(w.b, Q, tol)) || (near(w.a, Q, tol) && near(w.b, P, tol)));
}

const c30 = Math.cos(Math.PI / 6);
const s30 = Math.sin(Math.PI / 6);
/** A point on the 30° wall that starts at (5, 1). */
const on30 = (d: number) => ({ x: 5 + c30 * d, y: 1 + s30 * d });
/** Rotate a point of a 5 × 4 m room by 30° about its centre, placed at (4, 4). */
const rot30 = (p: Vec2) => ({ x: 4 + (p.x - 2.5) * c30 - (p.y - 2) * s30, y: 4 + (p.x - 2.5) * s30 + (p.y - 2) * c30 });

const chamferOutline = [{ x: 1, y: 1 }, { x: 5, y: 1 }, { x: 7, y: 3 }, { x: 7, y: 5 }, { x: 1, y: 5 }];
const wing30Outline = [{ x: 1, y: 1 }, { x: 5, y: 1 }, on30(3), { x: 5 + 3 * c30, y: 5 }, { x: 1, y: 5 }];
const rotatedRoom = [rot30({ x: 0, y: 0 }), rot30({ x: 5, y: 0 }), rot30({ x: 5, y: 4 }), rot30({ x: 0, y: 4 })];

describe('raster recognition of oblique walls', () => {
  it('finds a 45° wall and joins it to the axis-aligned walls at the corners', () => {
    const img = renderSyntheticPlan({ width: 800, height: 600, pxPerM: PX, thickness: 0.2, outline: chamferOutline, gaps: [[{ x: 2.5, y: 5 }, { x: 3.5, y: 5 }]] });
    const out = detectRasterWalls(img);
    expect(out.walls).toHaveLength(5);
    const diagonal = findWall(out.walls, { x: 5, y: 1 }, { x: 7, y: 3 });
    expect(diagonal).toBeDefined();
    expect(diagonal!.thickness).toBeGreaterThan(18);
    expect(diagonal!.thickness).toBeLessThan(23);
    expect(findWall(out.walls, { x: 1, y: 1 }, { x: 5, y: 1 })).toBeDefined();
    expect(findWall(out.walls, { x: 7, y: 3 }, { x: 7, y: 5 })).toBeDefined();
    expect(findWall(out.walls, { x: 1, y: 5 }, { x: 7, y: 5 })).toBeDefined();
    expect(findWall(out.walls, { x: 1, y: 1 }, { x: 1, y: 5 })).toBeDefined();
    expect(out.openings).toHaveLength(1);
    expect(out.openings[0].center.x).toBeCloseTo(300, -1);
  });

  it('keeps the adjoining straight wall and finds a door inside a 30° wall', () => {
    const hinge = on30(1);
    const img = renderSyntheticPlan({
      width: 900,
      height: 600,
      pxPerM: PX,
      thickness: 0.2,
      outline: wing30Outline,
      gaps: [[on30(1), on30(1.9)]],
      // door leaf (open by 90°, into the room) and swing arc
      thinLines: [doorArc(hinge, 0.9, Math.PI / 6, Math.PI / 6 + Math.PI / 2), [hinge, { x: hinge.x - s30 * 0.9, y: hinge.y + c30 * 0.9 }]],
    });
    const out = detectRasterWalls(img);
    expect(findWall(out.walls, { x: 1, y: 1 }, { x: 5, y: 1 })).toBeDefined(); // used to be lost next to the diagonal
    expect(findWall(out.walls, { x: 5, y: 1 }, on30(3))).toBeDefined();
    expect(findWall(out.walls, on30(3), { x: 5 + 3 * c30, y: 5 })).toBeDefined();
    expect(out.walls).toHaveLength(5);
    const doors = out.openings.filter((o) => o.kind === 'door');
    expect(doors).toHaveLength(1);
    expect(near(doors[0].center, px(on30(1.45)), 4)).toBe(true);
    expect(doors[0].width).toBeGreaterThan(86);
    expect(doors[0].width).toBeLessThan(94);
    // swings into the room: perpendicular to the wall, towards (−sin30°, cos30°)
    expect(doors[0].swingSide!.x * -s30 + doors[0].swingSide!.y * c30).toBeGreaterThan(0.95);
  });

  it('recognises a whole room rotated by 30°', () => {
    const img = renderSyntheticPlan({ width: 800, height: 800, pxPerM: PX, thickness: 0.2, outline: rotatedRoom, gaps: [[rot30({ x: 1.5, y: 4 }), rot30({ x: 2.5, y: 4 })]] });
    const out = detectRasterWalls(img);
    expect(out.walls).toHaveLength(4);
    for (let i = 0; i < 4; i++) expect(findWall(out.walls, rotatedRoom[i], rotatedRoom[(i + 1) % 4], 2)).toBeDefined();
    expect(out.openings).toHaveLength(1);
    expect(near(out.openings[0].center, px(rot30({ x: 2, y: 4 })), 3)).toBe(true);
    expect(out.openings[0].width).toBeCloseTo(100, -1);
  });

  it('leaves the result for axis-aligned plans unchanged', () => {
    const img = renderSyntheticPlan({
      width: 1300,
      height: 1000,
      pxPerM: PX,
      thickness: 0.24,
      outline: [{ x: 1, y: 1 }, { x: 12, y: 1 }, { x: 12, y: 9 }, { x: 1, y: 9 }],
      walls: [
        [{ x: 6, y: 1 }, { x: 6, y: 9 }],
        [{ x: 1, y: 5 }, { x: 12, y: 5 }],
      ],
      gaps: [
        [{ x: 6, y: 2 }, { x: 6, y: 2.9 }],
        [{ x: 3, y: 5 }, { x: 3.9, y: 5 }],
      ],
      thinLines: [doorArc({ x: 3, y: 5 }, 0.9, 0, Math.PI / 2), doorArc({ x: 6, y: 2 }, 0.9, Math.PI / 2, Math.PI)],
    });
    const withOblique = detectRasterWalls(img);
    const axisOnly = detectRasterWalls({ ...img, oblique: false });
    expect(withOblique).toEqual(axisOnly);
    expect(withOblique.walls.length).toBeGreaterThanOrEqual(6);
  });
});

/** Remove the part of all wall face lines along the gap a→b (vector door gap) and add the jamb lines. */
function cutGap(segments: VectorSegment[], a: Vec2, b: Vec2, thickness: number): VectorSegment[] {
  const A = px(a);
  const B = px(b);
  const L = Math.hypot(B.x - A.x, B.y - A.y);
  const u = { x: (B.x - A.x) / L, y: (B.y - A.y) / L };
  const n = { x: -u.y, y: u.x };
  const half = (thickness * PX) / 2;
  const out: VectorSegment[] = [];
  for (const s of segments) {
    const s0 = (s.x1 - A.x) * u.x + (s.y1 - A.y) * u.y;
    const s1 = (s.x2 - A.x) * u.x + (s.y2 - A.y) * u.y;
    const d0 = (s.x1 - A.x) * n.x + (s.y1 - A.y) * n.y;
    const d1 = (s.x2 - A.x) * n.x + (s.y2 - A.y) * n.y;
    if (Math.abs(d0 - d1) > 0.01 || Math.abs(d0) > half + 0.5) {
      out.push(s);
      continue;
    }
    const at = (t: number) => ({ x: A.x + u.x * t + n.x * d0, y: A.y + u.y * t + n.y * d0 });
    const lo = Math.min(s0, s1);
    const hi = Math.max(s0, s1);
    for (const [p, q] of [
      [lo, Math.min(hi, 0)],
      [Math.max(lo, L), hi],
    ]) {
      if (q - p > 0.01) {
        const P = at(p);
        const Q = at(q);
        out.push({ x1: P.x, y1: P.y, x2: Q.x, y2: Q.y });
      }
    }
  }
  for (const t of [0, L]) out.push({ x1: A.x + u.x * t - n.x * half, y1: A.y + u.y * t - n.y * half, x2: A.x + u.x * t + n.x * half, y2: A.y + u.y * t + n.y * half });
  return out;
}

const polylineSegments = (pts: Vec2[]): VectorSegment[] => pts.slice(1).map((p, i) => ({ x1: pts[i].x * PX, y1: pts[i].y * PX, x2: p.x * PX, y2: p.y * PX }));

describe('vector recognition of oblique walls', () => {
  it('finds a 45° wall exactly and ignores hatching inside the walls', () => {
    const segments = outlineSegments(chamferOutline, 0.2, PX);
    // 45° hatching (10 cm spacing) inside the bottom wall – must not become walls
    for (let x = 1.2; x < 6.8; x += 0.1) segments.push({ x1: x * PX, y1: 490, x2: x * PX + 20, y2: 510 });
    const out = detectVectorWalls(segments, 1 / PX);
    expect(out.walls).toHaveLength(5);
    for (let i = 0; i < 5; i++) {
      const w = findWall(out.walls, chamferOutline[i], chamferOutline[(i + 1) % 5], 0.5);
      expect(w).toBeDefined();
      expect(w!.thickness).toBeCloseTo(20, 3);
    }
  });

  it('recognises a whole room rotated by 30°', () => {
    const out = detectVectorWalls(outlineSegments(rotatedRoom, 0.2, PX), 1 / PX);
    expect(out.walls).toHaveLength(4);
    for (let i = 0; i < 4; i++) expect(findWall(out.walls, rotatedRoom[i], rotatedRoom[(i + 1) % 4], 0.5)).toBeDefined();
  });

  it('finds a door with its swing side in a 30° wall', () => {
    const hinge = on30(1);
    const segments = [
      ...cutGap(outlineSegments(wing30Outline, 0.2, PX), on30(1), on30(1.9), 0.2),
      ...polylineSegments([hinge, { x: hinge.x - s30 * 0.9, y: hinge.y + c30 * 0.9 }]),
      ...polylineSegments(doorArc(hinge, 0.9, Math.PI / 6, Math.PI / 6 + Math.PI / 2, 12)),
    ];
    const out = detectVectorWalls(segments, 1 / PX);
    expect(out.walls).toHaveLength(5);
    expect(findWall(out.walls, { x: 5, y: 1 }, on30(3), 0.5)).toBeDefined();
    expect(out.openings).toHaveLength(1);
    const door = out.openings[0];
    expect(door.kind).toBe('door');
    expect(near(door.center, px(on30(1.45)), 1)).toBe(true);
    expect(door.width).toBeCloseTo(90, 0);
    expect(door.swingSide!.x * -s30 + door.swingSide!.y * c30).toBeGreaterThan(0.99);
  });

  it('leaves the result for axis-aligned drawings unchanged (door leaf and arc are not walls)', () => {
    const seg = (x1: number, y1: number, x2: number, y2: number) => ({ x1, y1, x2, y2 });
    const segments = [seg(90, 90, 610, 90), seg(110, 110, 590, 110), seg(90, 510, 610, 510), seg(110, 490, 590, 490), seg(90, 90, 90, 510), seg(110, 110, 110, 490), seg(610, 90, 610, 510), seg(590, 110, 590, 490)];
    segments.push(seg(300, 490, 370, 420), ...polylineSegments(doorArc({ x: 3, y: 4.9 }, 1, -Math.PI / 4, -Math.PI / 2, 8)));
    const withOblique = detectVectorWalls(segments, 0.01);
    expect(withOblique).toEqual(detectVectorWalls(segments, 0.01, { oblique: false }));
    expect(withOblique.walls).toHaveLength(4);
  });
});
