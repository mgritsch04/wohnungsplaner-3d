import { describe, expect, it } from 'vitest';
import { createFurnitureFromCatalog } from '../catalog/instantiate';
import { findCatalogItem } from '../catalog/generic';
import { createEmptyProject } from './factory';
import { addOpening, addPolygonRoom, addRectRoom, closestWall } from './operations';
import { derivePlan } from './derived';
import { clearanceLabel, furnitureClearances, type Clearance, type ClearanceSide } from './clearances';
import type { Project } from './schema';
import { closestPointOnSegment, dist, sub } from './vec';

const props = { thickness: 0.12, height: 2.6 };

/** 6 × 5 m room, interior x 0..6, y 0..5 */
function room() {
  const p = createEmptyProject();
  addRectRoom(p, { x: 0, y: 0, width: 6, depth: 5, name: 'R', ...props });
  return p;
}

function box(p: Project, catalogId: string, x: number, y: number, width = 1, depth = 1, extra: Record<string, unknown> = {}) {
  const f = { ...createFurnitureFromCatalog(findCatalogItem(catalogId)!, { x, y }), x, y, width, depth, rotation: 0, ...extra };
  p.furniture.push(f);
  return f;
}

const bySide = (res: Clearance[]) => Object.fromEntries(res.map((c) => [c.side, c])) as Partial<Record<ClearanceSide, Clearance>>;
const calc = (p: Project, id: string, opts = {}) => bySide(furnitureClearances(p, derivePlan(p), id, opts));

describe('clearances while dragging (#50)', () => {
  it('measures the four wall distances of an item in an empty room exactly', () => {
    const p = room();
    const f = box(p, 'generic-sideboard', 2.8, 2.1, 1.6, 0.4); // x 2.0 … 3.6, y 1.9 … 2.3
    const c = calc(p, f.id);
    expect(c.left!.distance).toBeCloseTo(2.0, 9);
    expect(c.right!.distance).toBeCloseTo(2.4, 9);
    expect(c.back!.distance).toBeCloseTo(1.9, 9);
    expect(c.front!.distance).toBeCloseTo(2.7, 9);
    // lines start at the middle of the edge and end on the wall face
    expect(c.left!.from).toEqual({ x: expect.closeTo(2.0, 9), y: expect.closeTo(2.1, 9) });
    expect(c.left!.to).toEqual({ x: expect.closeTo(0, 9), y: expect.closeTo(2.1, 9) });
    expect(c.back!.to).toEqual({ x: expect.closeTo(2.8, 9), y: expect.closeTo(0, 9) });
    expect(c.front!.to).toEqual({ x: expect.closeTo(2.8, 9), y: expect.closeTo(5, 9) });
    for (const k of ['left', 'back'] as const) {
      expect(c[k]!.hit.type).toBe('wall');
      expect(dist(c[k]!.from, c[k]!.to)).toBeCloseTo(c[k]!.distance, 9);
    }
    expect(c.left!.hit.id).toBe(closestWall(p, { x: 0, y: 2.5 })!.wall.id);
    expect(clearanceLabel(c.left!.distance)).toBe('200 cm');
    expect(clearanceLabel(0.424)).toBe('42 cm');
    expect(clearanceLabel(0.425)).toBe('43 cm');
  });

  it('stops at a neighbouring item that is nearer than the wall', () => {
    const p = room();
    const f = box(p, 'generic-sideboard', 2, 2.5); // x 1.5 … 2.5
    const n = box(p, 'generic-dresser', 3.3, 2.8, 0.6, 1); // x 3.0 … 3.6, y 2.3 … 3.3 – overlaps the strip partly
    const c = calc(p, f.id);
    expect(c.right!.distance).toBeCloseTo(0.5, 9);
    expect(c.right!.hit).toEqual({ type: 'furniture', id: n.id });
    // the line sits where the neighbour actually is (lateral overlap y 2.3 … 3.0 contains the edge middle)
    expect(c.right!.from.y).toBeCloseTo(2.5, 9);
    expect(c.right!.to.x).toBeCloseTo(3.0, 9);
    // an item only beside the strip does not block
    n.y = 3.6; // y 3.1 … 4.1
    expect(calc(p, f.id, { maxDistance: 6 }).right!.hit.type).toBe('wall');
    expect(calc(p, f.id, { maxDistance: 6 }).right!.distance).toBeCloseTo(3.5, 9);
    // the neighbour as seen from its own side
    n.y = 2.8;
    expect(calc(p, n.id).left!.distance).toBeCloseTo(0.5, 9);
    // the line lies in the lateral overlap (neighbour y 2.3 … 3.3, item y 2.0 … 3.0)
    const nl = calc(p, n.id).left!;
    expect(nl.from.y).toBeGreaterThanOrEqual(2.3 - 1e-9);
    expect(nl.from.y).toBeLessThanOrEqual(3.0 + 1e-9);
  });

  it('measures along the axes of a rotated item (45°)', () => {
    const p = room();
    const f = box(p, 'generic-sideboard', 3, 2.5, 1, 1, { rotation: Math.PI / 4 });
    const c = calc(p, f.id);
    // local +x points to (1,1)/√2, the middle of the right edge is (3.354, 2.854)
    const h = 0.5 / Math.SQRT2;
    // the line runs from the corner end of the edge (where the wall is hit) – local (0.5, 0.499)
    expect(c.right!.from.x).toBeCloseTo(3 + h - 0.499 * Math.SQRT1_2, 9);
    expect(c.right!.from.y).toBeCloseTo(2.5 + h + 0.499 * Math.SQRT1_2, 9);
    // the whole edge sweeps diagonally; its leading corner (local (0.5, 0.5)) touches y = 5 first
    // (the swept strip is 1 mm narrower on each side, so the corner is local (0.5, 0.499))
    const corner = 2.5 + (0.5 + 0.499) * Math.SQRT1_2;
    expect(c.right!.distance).toBeCloseTo((5 - corner) * Math.SQRT2, 9);
    expect(c.right!.to.y).toBeCloseTo(5, 9);
    // direction of every line = the item's axis
    for (const k of Object.values(c)) {
      const d = sub(k!.to, k!.from);
      const along = Math.abs(d.x * Math.SQRT1_2 + d.y * Math.SQRT1_2);
      const across = Math.abs(-d.x * Math.SQRT1_2 + d.y * Math.SQRT1_2);
      expect(Math.max(along, across)).toBeCloseTo(k!.distance, 9);
      expect(Math.min(along, across)).toBeLessThan(1e-9);
    }
    expect(Object.keys(c).sort()).toEqual(['back', 'front', 'left', 'right']);
  });

  it('hits a slanted wall on its inner face', () => {
    const p = createEmptyProject();
    // trapezoid: right wall runs from (6, 0) to (5, 5) on the centre line
    addPolygonRoom(p, [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 5 }], 'T', props);
    const f = box(p, 'generic-sideboard', 2, 2.5, 1, 0.5);
    const d = derivePlan(p);
    const c = bySide(furnitureClearances(p, d, f.id));
    const interior = [...d.rooms.values()][0].interior;
    // the slanted face of the interior polygon
    const faces = interior.map((a, i) => [a, interior[(i + 1) % interior.length]] as const);
    const slanted = faces.find(([a, b]) => Math.abs(a.x - b.x) > 0.5 && Math.abs(a.y - b.y) > 0.5)!;
    expect(slanted).toBeTruthy();
    // the right edge (x = 2.5, y 2.25 … 2.75) sweeps until its upper/lower corner touches the face;
    // the face moves left with growing y, so the corner at y = 2.749 (strip 1 mm narrower) hits first
    const yc = 2.75 - 0.001;
    const t = (yc - slanted[0].y) / (slanted[1].y - slanted[0].y);
    const xFace = slanted[0].x + (slanted[1].x - slanted[0].x) * t;
    expect(c.right!.distance).toBeCloseTo(xFace - 2.5, 6);
    expect(c.right!.to.y).toBeCloseTo(yc, 6);
    expect(closestPointOnSegment(c.right!.to, slanted[0], slanted[1]).distance).toBeLessThan(1e-9);
    expect(c.right!.hit.type).toBe('wall');
  });

  it('ignores rugs and flat parts; a dragged rug measures only to walls', () => {
    const p = room();
    const f = box(p, 'generic-sideboard', 2, 2.5);
    const rug = box(p, 'generic-rug-200', 3.5, 2.5, 1, 1);
    box(p, 'generic-sideboard', 2, 3.6, 1, 1, { height: 0.02 }); // flat mat-like part in front
    const c = calc(p, f.id, { maxDistance: 6 });
    expect(c.right!.hit.type).toBe('wall');
    expect(c.right!.distance).toBeCloseTo(3.5, 9);
    expect(c.front!.hit.type).toBe('wall');
    expect(c.front!.distance).toBeCloseTo(2, 9);
    // a rug next to a sofa still measures to the walls
    box(p, 'generic-sofa-3', 3.5, 4, 1, 0.8);
    const r = calc(p, rug.id);
    expect(Object.values(r).every((x) => x!.hit.type === 'wall')).toBe(true);
    expect(r.front!.distance).toBeCloseTo(2, 9);
  });

  it('ignores items at another height and overlapping items; walls below a window block, doors let it pass', () => {
    const p = room();
    const f = box(p, 'generic-sideboard', 3, 2.5, 1, 1, { height: 0.8 }); // x 2.5 … 3.5
    box(p, 'generic-k-wall-60', 4.5, 2.5, 1, 0.35, { elevation: 1.45 }); // wall cabinet above the path
    box(p, 'generic-sideboard', 3.4, 2.5, 0.4, 0.4); // overlaps the item
    const c = calc(p, f.id);
    expect(c.right!.hit.type).toBe('wall');
    expect(c.right!.distance).toBeCloseTo(2.5, 9);
    // window in the left wall: the sideboard (0.8 m) is below the sill and still sees the wall
    const left = closestWall(p, { x: 0, y: 2.5 })!;
    addOpening(p, left.wall.id, 'window', left.s);
    expect(calc(p, f.id).left!.distance).toBeCloseTo(2.5, 9);
    // a door lets the measurement pass into the next room
    const p3 = room();
    addRectRoom(p3, { x: -3.12, y: 0, width: 3, depth: 5, name: 'L', ...props });
    const h = box(p3, 'generic-sideboard', 1, 2.5, 1, 1, { height: 0.8 }); // x 0.5 … 1.5
    const wall = closestWall(p3, { x: -0.06, y: 2.5 })!;
    addOpening(p3, wall.wall.id, 'door', wall.s, { width: 1.2 });
    const c3 = calc(p3, h.id, { maxDistance: 6 });
    expect(c3.left!.distance).toBeCloseTo(3.62, 9);
    expect(calc(p3, h.id).left).toBeUndefined(); // 3.62 m > 3 m
  });

  it('omits distances above the limit, touching items and directions without a hit', () => {
    const p = room();
    const f = box(p, 'generic-sideboard', 0.5, 2.5); // left side flush with the wall x = 0
    const c = calc(p, f.id);
    expect(c.left).toBeUndefined(); // touching
    expect(c.right).toBeUndefined(); // 5 m > 3 m
    expect(c.back!.distance).toBeCloseTo(2, 9);
    expect(calc(p, f.id, { maxDistance: 1.5 }).back).toBeUndefined();
    expect(calc(p, f.id, { maxDistance: 6 }).right!.distance).toBeCloseTo(5, 9);
    // free-standing without walls: nothing to measure
    const q = createEmptyProject();
    const g = box(q, 'generic-sideboard', 0, 0);
    expect(furnitureClearances(q, derivePlan(q), g.id)).toEqual([]);
    expect(furnitureClearances(q, derivePlan(q), 'nope')).toEqual([]);
  });

  it('stays fast: 25 rooms, 100 items – fastest of 7 runs below 2 ms', () => {
    const p = createEmptyProject();
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) addRectRoom(p, { x: i * 4.12, y: j * 3.62, width: 4, depth: 3.5, name: `R${i}-${j}`, ...props });
    for (let k = 0; k < 100; k++) {
      const i = k % 5;
      const j = Math.floor(k / 5) % 5;
      const q = Math.floor(k / 25);
      box(p, 'generic-sideboard', i * 4.12 + 1 + (q % 2) * 2, j * 3.62 + 1 + Math.floor(q / 2) * 1.5, 0.8, 0.4, { rotation: (k % 3) * 0.3 });
    }
    const d = derivePlan(p);
    const id = p.furniture[60].id;
    let fastest = Infinity;
    let n = 0;
    for (let run = 0; run < 7; run++) {
      const t0 = performance.now();
      n = furnitureClearances(p, d, id).length;
      fastest = Math.min(fastest, performance.now() - t0);
    }
    console.log(`Abstände (25 Räume, ${p.furniture.length} Möbel, ${p.walls.length} Wände): schnellster Lauf ${fastest.toFixed(3)} ms`);
    expect(n).toBeGreaterThan(0);
    expect(fastest).toBeLessThan(2);
  });
});
