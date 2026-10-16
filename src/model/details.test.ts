import { describe, expect, it } from 'vitest';
import { createEmptyProject } from './factory';
import { addOpening, addPolygonRoom, addRectRoom, closestWall, insertWall } from './operations';
import { derivePlan } from './derived';
import { BASEBOARD_THICKNESS as T, computeBaseboards, computeWindowSills } from './geometry/details';
import { dist, pointInPolygon } from './vec';

const props = { thickness: 0.2, height: 2.5 };
const total = (b: { a: { x: number; y: number }; b: { x: number; y: number } }[]) => b.reduce((s, x) => s + dist(x.a, x.b), 0);

function room() {
  const p = createEmptyProject();
  addRectRoom(p, { x: 0, y: 0, width: 4, depth: 3, name: 'R', ...props });
  return p;
}

describe('skirting boards', () => {
  it('run along every inner wall face, extended into the corners, interrupted by a door', () => {
    const p = room();
    const plain = computeBaseboards(p, derivePlan(p));
    expect(plain).toHaveLength(4);
    expect(total(plain)).toBeCloseTo(14 + 8 * T, 6);
    const south = closestWall(p, { x: 2, y: 3.1 })!;
    addOpening(p, south.wall.id, 'door', south.s, { width: 0.9 });
    const d = derivePlan(p);
    const withDoor = computeBaseboards(p, d);
    expect(withDoor).toHaveLength(5);
    expect(total(withDoor)).toBeCloseTo(14 + 8 * T - 0.9, 6);
    const g = [...d.rooms.values()][0];
    for (const b of withDoor) {
      const mid = { x: (b.a.x + b.b.x) / 2 + b.inward.x * 0.05, y: (b.a.y + b.b.y) / 2 + b.inward.y * 0.05 };
      expect(pointInPolygon(mid, g.interior)).toBe(true);
    }
    // no board inside the door opening
    const door = p.openings[0];
    const fp = d.footprints.get(door.wallId)!;
    const doorMid = { x: fp.a.x + fp.dir.x * door.offset, y: fp.a.y + fp.dir.y * door.offset };
    for (const b of withDoor.filter((x) => x.wallId === door.wallId)) {
      const t0 = Math.min(b.a.x, b.b.x);
      const t1 = Math.max(b.a.x, b.b.x);
      expect(doorMid.x < t0 + 0.45 - 1e-6 || doorMid.x > t1 - 0.45 + 1e-6 || t1 < doorMid.x - 0.45 + 1e-6 || t0 > doorMid.x + 0.45 - 1e-6).toBe(true);
    }
  });

  it('keeps boards below high windows but cuts them for floor-length windows', () => {
    const p = room();
    const north = closestWall(p, { x: 2, y: -0.1 })!;
    addOpening(p, north.wall.id, 'window', north.s, { width: 1.2 });
    expect(computeBaseboards(p, derivePlan(p))).toHaveLength(4);
    p.openings[0].sillHeight = 0;
    expect(computeBaseboards(p, derivePlan(p))).toHaveLength(5);
  });

  it('covers L-shaped rooms including the convex corner', () => {
    const p = createEmptyProject();
    addPolygonRoom(p, [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 4 }, { x: 0, y: 4 }], 'L', props);
    const b = computeBaseboards(p, derivePlan(p));
    expect(b).toHaveLength(6);
    // each face is extended at both ends → the corner protruding into the room at (1.9, 1.9) is closed
    const nearConvex = b.filter((x) => [x.a, x.b].some((q) => Math.hypot(q.x - 1.9, q.y - 1.9) < 2 * T + 1e-6));
    expect(nearConvex).toHaveLength(2);
  });

  it('adds boards to both sides and the free end of a wall stub inside a room', () => {
    const p = room();
    insertWall(p, { x: 2, y: -0.1 }, { x: 2, y: 1.5 }, { thickness: 0.1, height: 2.5 });
    const d = derivePlan(p);
    const stub = p.walls.find((w) => {
      const a = d.index.nodes.get(w.a)!;
      const bb = d.index.nodes.get(w.b)!;
      return Math.abs(a.x - 2) < 1e-9 && Math.abs(bb.x - 2) < 1e-9;
    })!;
    const onStub = computeBaseboards(p, d).filter((x) => x.wallId === stub.id);
    expect(onStub).toHaveLength(3); // two faces + end face
  });

  it('works for enclosed walls without a room record, but not on exterior faces', () => {
    const p = createEmptyProject();
    for (const [a, b] of [
      [{ x: 0, y: 0 }, { x: 3, y: 0 }],
      [{ x: 3, y: 0 }, { x: 3, y: 3 }],
      [{ x: 3, y: 3 }, { x: 0, y: 3 }],
      [{ x: 0, y: 3 }, { x: 0, y: 0 }],
    ])
      insertWall(p, a, b, props);
    expect(p.rooms).toHaveLength(0);
    const b = computeBaseboards(p, derivePlan(p));
    expect(b).toHaveLength(4);
    for (const s of b) {
      const mid = { x: (s.a.x + s.b.x) / 2 + s.inward.x, y: (s.a.y + s.b.y) / 2 + s.inward.y };
      expect(mid.x > 0 && mid.x < 3 && mid.y > 0 && mid.y < 3).toBe(true);
    }
  });

  it('adds sills inside and outside a window', () => {
    const p = room();
    const north = closestWall(p, { x: 2, y: -0.1 })!;
    addOpening(p, north.wall.id, 'window', north.s, { width: 1.2 });
    const sills = computeWindowSills(p, derivePlan(p));
    expect(sills.map((s) => s.side).sort()).toEqual(['inside', 'outside']);
    const inside = sills.find((s) => s.side === 'inside')!;
    expect(inside.height).toBeCloseTo(0.9, 6);
    expect(inside.outward.y).toBeGreaterThan(0);
  });
});
