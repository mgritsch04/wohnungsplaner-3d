import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '../model/factory';
import { addRectRoom, closestWall, insertWall } from '../model/operations';
import { derivePlan } from '../model/derived';
import { buildPlacementObstacles, collidingObstacles, furnitureConflicts } from '../model/placement';
import { generateCountertops, kitchenChecksForItem, kitchenComponents, placeKitchenRun, wallFaceLength } from './kitchen';

function kitchenProject() {
  const p = createEmptyProject();
  insertWall(p, { x: 0, y: 0 }, { x: 4, y: 0 }, { thickness: 0.2, height: 2.6 });
  return p;
}

describe('kitchen planner', () => {
  it('places modules flush against the wall face in a row', () => {
    const p = kitchenProject();
    const ids = placeKitchenRun(p, { wallId: p.walls[0].id, side: 1, start: 0.2, modules: [{ catalogId: 'generic-k-base-60' }, { catalogId: 'generic-k-sink-80' }, { catalogId: 'generic-k-wall-60' }] });
    expect(ids).toHaveLength(3);
    const [a, b, w] = ids.map((id) => p.furniture.find((f) => f.id === id)!);
    // back face touches the wall face at y = 0.1 (+2 mm clearance)
    expect(a.y - a.depth / 2).toBeCloseTo(0.102, 6);
    expect(a.x).toBeCloseTo(0.5, 6);
    expect(b.x).toBeCloseTo(0.2 + 0.6 + 0.4, 6);
    expect(w.elevation).toBeCloseTo(1.45, 6);
    expect(kitchenChecksForItem(p, a.id)).toEqual([]);
  });

  it('generates one countertop over contiguous base cabinets', () => {
    const p = kitchenProject();
    placeKitchenRun(p, { wallId: p.walls[0].id, side: 1, start: 0, modules: [{ catalogId: 'generic-k-base-60' }, { catalogId: 'generic-k-dishwasher' }, { catalogId: 'generic-k-sink-80' }] });
    expect(generateCountertops(p)).toBe(1);
    const top = p.furniture.find((f) => f.kitchen?.type === 'countertop')!;
    expect(top.width).toBeCloseTo(2.0, 6);
    expect(top.elevation).toBeCloseTo(0.86, 6);
    // regenerating replaces instead of duplicating
    generateCountertops(p);
    expect(p.furniture.filter((f) => f.kitchen?.type === 'countertop')).toHaveLength(1);
    const comps = kitchenComponents(p);
    expect(comps.countertopLength).toBeCloseTo(2, 6);
    expect(comps.total).toBeGreaterThan(0);
  });

  it('reports overlaps and wall collisions', () => {
    const p = kitchenProject();
    const [a] = placeKitchenRun(p, { wallId: p.walls[0].id, side: 1, start: 0, modules: [{ catalogId: 'generic-k-base-60' }] });
    const [b] = placeKitchenRun(p, { wallId: p.walls[0].id, side: 1, start: 0.3, modules: [{ catalogId: 'generic-k-base-60' }] });
    expect(kitchenChecksForItem(p, a).join()).toMatch(/Überschneidet/);
    const f = p.furniture.find((x) => x.id === b)!;
    f.y = 0;
    expect(kitchenChecksForItem(p, b).join()).toMatch(/Wand/);
  });

  it('starts at the inner room corner: no module stands in the wall or the connected wall (#16)', () => {
    for (const thickness of [0.12, 0.24]) {
      const p = createEmptyProject();
      addRectRoom(p, { x: 0, y: 0, width: 4, depth: 3, name: 'K', thickness, height: 2.6 }); // interior 0..4 × 0..3
      const w = closestWall(p, { x: 2, y: -thickness / 2 })!;
      // the room side of the north wall
      const side = (derivePlan(p).footprints.get(w.wall.id)!.normal.y > 0 ? 1 : -1) as 1 | -1;
      expect(wallFaceLength(p, w.wall.id, side)).toBeCloseTo(4, 6);
      const ids = placeKitchenRun(p, {
        wallId: w.wall.id,
        side,
        start: 0,
        modules: [{ catalogId: 'generic-k-tall-60' }, { catalogId: 'generic-k-base-60' }, { catalogId: 'generic-k-sink-80' }, { catalogId: 'generic-k-wall-60' }],
      });
      generateCountertops(p);
      const d = derivePlan(p);
      const walls = buildPlacementObstacles(d).filter((o) => o.kind === 'wall');
      const items = ids.map((id) => p.furniture.find((f) => f.id === id)!);
      for (const f of p.furniture) expect(collidingObstacles(f, walls), `${f.name} in der Wand`).toEqual([]);
      // flush in the corner: first module begins at the inner face of the west wall, backs on the north face
      const xs = (f: (typeof items)[0]) => [f.x - f.width / 2, f.x + f.width / 2];
      const first = items.find((f) => f.kitchen?.type === 'tall')!;
      const [x0, x1] = xs(first);
      expect(Math.min(x0, x1)).toBeGreaterThanOrEqual(0);
      expect(Math.min(x0, x1)).toBeLessThan(0.005);
      for (const f of items) expect(f.y - f.depth / 2).toBeCloseTo(0.002, 3);
      expect([...furnitureConflicts(p, d, buildPlacementObstacles(d)).values()].flatMap((c) => c.issues.map((i) => i.message))).toEqual([]);
    }
  });
});
