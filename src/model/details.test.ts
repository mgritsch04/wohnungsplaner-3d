import { describe, expect, it } from 'vitest';
import { createEmptyProject } from './factory';
import { addOpening, addRectRoom, closestWall } from './operations';
import { derivePlan } from './derived';
import { computeBaseboards, computeWindowSills } from './geometry/details';
import { dist, pointInPolygon } from './vec';

function room() {
  const p = createEmptyProject();
  addRectRoom(p, { x: 0, y: 0, width: 4, depth: 3, name: 'R', thickness: 0.2, height: 2.5 });
  return p;
}

describe('architectural details', () => {
  it('runs baseboards around the room, interrupted by a door', () => {
    const p = room();
    const plain = computeBaseboards(p, derivePlan(p));
    expect(plain).toHaveLength(4);
    expect(plain.reduce((s, b) => s + dist(b.a, b.b), 0)).toBeCloseTo(14, 6);
    const south = closestWall(p, { x: 2, y: 3.1 })!;
    addOpening(p, south.wall.id, 'door', south.s, { width: 0.9 });
    const d = derivePlan(p);
    const withDoor = computeBaseboards(p, d);
    expect(withDoor).toHaveLength(5);
    expect(withDoor.reduce((s, b) => s + dist(b.a, b.b), 0)).toBeCloseTo(14 - 0.9, 6);
    // inward normals point into the room
    const g = [...d.rooms.values()][0];
    for (const b of withDoor) {
      const mid = { x: (b.a.x + b.b.x) / 2 + b.inward.x * 0.05, y: (b.a.y + b.b.y) / 2 + b.inward.y * 0.05 };
      expect(pointInPolygon(mid, g.interior)).toBe(true);
    }
  });

  it('keeps baseboards below windows and adds sills inside and outside', () => {
    const p = room();
    const north = closestWall(p, { x: 2, y: -0.1 })!;
    addOpening(p, north.wall.id, 'window', north.s, { width: 1.2 });
    const d = derivePlan(p);
    expect(computeBaseboards(p, d)).toHaveLength(4);
    const sills = computeWindowSills(p, d);
    expect(sills.map((s) => s.side).sort()).toEqual(['inside', 'outside']);
    const inside = sills.find((s) => s.side === 'inside')!;
    expect(inside.height).toBeCloseTo(0.9, 6);
    expect(inside.width).toBeCloseTo(1.24, 6);
    expect(inside.outward.y).toBeGreaterThan(0); // towards the room (south)
  });
});
