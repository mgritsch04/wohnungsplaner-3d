import { describe, expect, it } from 'vitest';
import { createEmptyProject } from './factory';
import { addRectRoom } from './operations';
import { derivePlan } from './derived';
import { buildWallGeometry } from '../view3d/prismGeometry';

/** Grid of rooms – rough performance budget check for derived geometry. */
function grid(n: number) {
  const p = createEmptyProject();
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) addRectRoom(p, { x: i * 4.12, y: j * 3.62, width: 4, depth: 3.5, name: `R${i}-${j}`, thickness: 0.12, height: 2.6 });
  return p;
}

describe('performance (derived geometry)', () => {
  for (const [label, n, budgetMs] of [
    ['klein (4 Räume)', 2, 30],
    ['mittel (25 Räume)', 5, 150],
    ['groß (100 Räume)', 10, 1200],
  ] as const) {
    it(`${label}: derivePlan + 3D-Wandmeshes`, () => {
      const p = grid(n);
      const t0 = performance.now();
      const d = derivePlan(p);
      for (const w of p.walls) buildWallGeometry(d.footprints.get(w.id)!, d.pieces.get(w.id)!).dispose();
      const ms = performance.now() - t0;
      console.log(`${label}: ${p.walls.length} Wände, ${p.rooms.length} Räume → ${ms.toFixed(1)} ms`);
      expect(d.rooms.size).toBe(n * n);
      expect(ms).toBeLessThan(budgetMs);
    });
  }
});

describe('performance (furniture drag)', () => {
  it('one drag update across a 25-room plan (snap + collision + conflicts) stays interactive', async () => {
    const { buildPlacementObstacles, furnitureConflicts, moveFurnitureTo } = await import('./placement');
    const { createFurnitureFromCatalog } = await import('../catalog/instantiate');
    const { findCatalogItem } = await import('../catalog/generic');
    const p = grid(5);
    for (let i = 0; i < 25; i++) p.furniture.push(createFurnitureFromCatalog(findCatalogItem('generic-sofa-3')!, { x: 2 + (i % 5) * 4.12, y: 1.7 + Math.floor(i / 5) * 3.62, rotation: 0 }));
    const d = derivePlan(p);
    const obs = buildPlacementObstacles(d);
    const id = p.furniture[0].id;
    const t0 = performance.now();
    // a very fast pointer move: 8 m in one event, blocked by several walls
    moveFurnitureTo(p, d, obs, id, { x: 10, y: 1.7 }, { snap: true, collide: true });
    const t1 = performance.now();
    furnitureConflicts(p, d, obs);
    const tc = performance.now() - t1;
    const ms = performance.now() - t0;
    console.log(`Drag-Update (25 Räume, 25 Sofas): ${ms.toFixed(1)} ms (davon Konfliktprüfung ${tc.toFixed(1)} ms)`);
    expect(p.furniture[0].x).toBeLessThan(4); // stopped by the first wall
    expect(ms).toBeLessThan(60);
  });
});
