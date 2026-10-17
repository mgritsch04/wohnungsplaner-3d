import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '../model/factory';
import { addOpening, addRectRoom, closestWall, insertWall } from '../model/operations';
import { derivePlan } from '../model/derived';
import { buildPlacementObstacles, collidingObstacles, furnitureConflicts } from '../model/placement';
import { generateCountertops, kitchenChecksForItem, kitchenComponents, layoutKitchenRun, placeKitchenRun, placeKitchenRunReport, wallFaceLength } from './kitchen';

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
    const [b] = placeKitchenRun(p, { wallId: p.walls[0].id, side: 1, start: 0.6, modules: [{ catalogId: 'generic-k-base-60' }] });
    const f = p.furniture.find((x) => x.id === b)!;
    f.x -= 0.3;
    expect(kitchenChecksForItem(p, a).join()).toMatch(/Überschneidet/);
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

  /** North wall with two cross walls that only overlap it, as after a floor-plan import (#220). */
  function importedRoom() {
    const p = createEmptyProject();
    const props = { thickness: 0.2, height: 2.6 };
    insertWall(p, { x: 0, y: 0 }, { x: 4, y: 0 }, props); // face on side 1 at y = 0.1
    insertWall(p, { x: 0.1, y: 0.06 }, { x: 0.1, y: 3 }, props); // inner face x = 0.2
    insertWall(p, { x: 3.1, y: 0.06 }, { x: 3.1, y: 3 }, props); // inner face x = 3.0
    const north = p.walls.find((w) => w.a === p.nodes[0].id || w.b === p.nodes[0].id)!;
    return { p, north };
  }

  const RUN = ['generic-k-tall-60', 'generic-k-drawer-60', 'generic-k-sink-80', 'generic-k-dishwasher', 'generic-k-oven', 'generic-k-base-40'].map((catalogId) => ({ catalogId }));

  it('starts at the inner face of an unconnected cross wall and skips what does not fit (#220)', () => {
    const { p, north } = importedRoom();
    expect(p.walls).toHaveLength(3);
    expect(wallFaceLength(p, north.id, 1)).toBeCloseTo(2.8, 3);
    const layout = layoutKitchenRun(p, { wallId: north.id, side: 1, start: 0, modules: RUN });
    expect(layout.slots.map((s) => s.problem === null)).toEqual([true, true, true, true, false, false]);
    expect(layout.slots[4].problem).toMatch(/zu lang/);
    const { ids, skipped } = placeKitchenRunReport(p, { wallId: north.id, side: 1, start: 0, modules: RUN });
    expect(ids).toHaveLength(4);
    expect(skipped.map((s) => s.name)).toEqual(['Backofen-Umbau 60 cm', 'Unterschrank 40 cm']);
    const items = ids.map((id) => p.furniture.find((f) => f.id === id)!);
    const first = items[0];
    expect(first.x - first.width / 2).toBeGreaterThanOrEqual(0.2 - 1e-6);
    expect(first.x - first.width / 2).toBeLessThan(0.205);
    const d = derivePlan(p);
    const walls = buildPlacementObstacles(d).filter((o) => o.kind === 'wall');
    for (const f of items) expect(collidingObstacles(f, walls), `${f.name} in der Wand`).toEqual([]);
    for (const f of items) expect(kitchenChecksForItem(p, f.id)).toEqual([]);
  });

  it('does not place modules in front of a door, into existing furniture or past the wall end (#220)', () => {
    const p = kitchenProject();
    const wallId = p.walls[0].id;
    addOpening(p, wallId, 'door', 2.05, { open: false }); // door 1.6 … 2.5
    const [existing] = placeKitchenRun(p, { wallId, side: 1, start: 0, modules: [{ catalogId: 'generic-k-base-60' }] });
    expect(existing).toBeTruthy();
    const layout = layoutKitchenRun(p, {
      wallId,
      side: 1,
      start: 0.3,
      modules: [{ catalogId: 'generic-k-base-60' }, { catalogId: 'generic-k-base-60' }, { catalogId: 'generic-k-base-60' }, { catalogId: 'generic-k-base-60' }, { catalogId: 'generic-k-wall-60' }, { catalogId: 'generic-k-base-60' }, { catalogId: 'generic-k-base-60' }, { catalogId: 'generic-k-base-60' }],
    });
    // 0.3–0.9 hits the first cabinet, 0.9–1.5 free, 1.5–2.1 + 2.1–2.7 door (wall cabinet at 2.7 is free),
    // 2.7–3.3 free, 3.3–3.9 free, 3.9–4.5 past the end of the 4 m wall face
    expect(layout.slots.map((s) => s.problem)).toEqual([
      expect.stringMatching(/Unterschrank 60 cm/),
      null,
      expect.stringMatching(/Tür/),
      expect.stringMatching(/Tür/),
      null,
      null,
      null,
      expect.stringMatching(/zu lang/),
    ]);
  });
});

