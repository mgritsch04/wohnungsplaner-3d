import { describe, expect, it } from 'vitest';
import { createEmptyProject } from './factory';
import { addRectRoom } from './operations';
import { derivePlan } from './derived';
import { buildPlacementObstacles, moveFurnitureTo } from './placement';
import { createFurnitureFromCatalog } from '../catalog/instantiate';
import { findCatalogItem } from '../catalog/generic';
import { snapToFurniture } from './furnitureSnap';

function setup() {
  const p = createEmptyProject();
  addRectRoom(p, { x: 0, y: 0, width: 6, depth: 5, name: 'A', thickness: 0.12, height: 2.6 });
  const item = findCatalogItem('generic-tv-sideboard')!;
  const a = createFurnitureFromCatalog(item, { x: 3, y: 2.5, rotation: 0 });
  const b = createFurnitureFromCatalog(item, { x: 1.5, y: 1.5, rotation: 0 });
  p.furniture.push(a, b);
  return { p, a, b };
}

describe('snapping to other furniture', () => {
  it('lines up an edge with a neighbour within 6 cm and reports a guide', () => {
    const { p, a, b } = setup();
    const left = a.x - a.width / 2;
    const r = snapToFurniture(p, b, { x: left + 0.03 + b.width / 2, y: 1.5 });
    expect(r.x - b.width / 2).toBeCloseTo(left, 6);
    expect(r.guides.length).toBeGreaterThan(0);
  });

  it('does not snap further away than 6 cm', () => {
    const { p, a, b } = setup();
    const left = a.x - a.width / 2;
    const r = snapToFurniture(p, b, { x: left + 0.2 + b.width / 2, y: 1.5 });
    expect(r.x).toBeCloseTo(left + 0.2 + b.width / 2, 6);
    expect(r.guides).toHaveLength(0);
  });

  it('moveFurnitureTo aligns flush beside another item and fills guides', () => {
    const { p, a, b } = setup();
    const d = derivePlan(p);
    const obs = buildPlacementObstacles(d);
    const guides: { a: unknown; b: unknown }[] = [];
    b.x = a.x + a.width / 2 + b.width / 2 + 0.3;
    b.y = a.y + 0.2;
    // put b right of a, touching, 3 cm off vertically
    const target = { x: a.x + a.width / 2 + b.width / 2 + 0.02, y: a.y + 0.03 };
    moveFurnitureTo(p, d, obs, b.id, target, { snap: true, collide: true, guides: guides as never });
    const mb = p.furniture.find((f) => f.id === b.id)!;
    expect(mb.y).toBeCloseTo(a.y, 2);
    expect(guides.length).toBeGreaterThan(0);
  });
});
