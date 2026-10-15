import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '../model/factory';
import { insertWall } from '../model/operations';
import { generateCountertops, kitchenChecksForItem, kitchenComponents, placeKitchenRun } from './kitchen';

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
});
