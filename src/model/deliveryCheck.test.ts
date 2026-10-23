import { describe, expect, it } from 'vitest';
import { findCatalogItem } from '../catalog/generic';
import { createFurnitureFromCatalog } from '../catalog/instantiate';
import { checkDelivery, findEntrance } from './deliveryCheck';
import { derivePlan } from './derived';
import { createEmptyProject } from './factory';
import { addOpening, addRectRoom, closestWall } from './operations';
import type { Project } from './schema';

const props = { thickness: 0.12, height: 2.6 };

/** one room 6 × 4 m with an entrance door (0.9 × 2.1 m) in the left wall and a piece placed inside */
function flat(doorWidth: number, doorHeight: number, dims: { width: number; depth: number; height: number }): { p: Project; id: string } {
  const p = createEmptyProject();
  addRectRoom(p, { x: 0, y: 0, width: 6, depth: 4, name: 'R', ...props });
  const w = closestWall(p, { x: -0.06, y: 2 })!;
  addOpening(p, w.wall.id, 'door', w.s, { width: doorWidth, height: doorHeight });
  const f = { ...createFurnitureFromCatalog(findCatalogItem('generic-sofa-3')!, { x: 4, y: 2 }), x: 4, y: 2, rotation: 0, ...dims };
  p.furniture.push(f);
  return { p, id: f.id };
}
const check = ({ p, id }: { p: Project; id: string }) => checkDelivery(p, derivePlan(p), id);

describe('delivery route check (#358)', () => {
  it('finds the door with a room on one side only as entrance', () => {
    const { p } = flat(0.9, 2.1, { width: 2, depth: 0.9, height: 0.8 });
    expect(findEntrance(p, derivePlan(p))).not.toBeNull();
  });

  it('fits upright through a wide door', () => {
    const r = check(flat(0.9, 2.1, { width: 2.1, depth: 0.8, height: 0.8 }));
    expect(r.ok && r.fits && r.orientation).toBe('upright');
  });

  it('fits only on its end when the door is low', () => {
    const r = check(flat(0.9, 2.1, { width: 0.8, depth: 0.6, height: 2.2 }));
    expect(r.ok && r.fits).toBe(true);
    if (r.ok) expect(r.orientation).toBe('tilted');
  });

  it('does not fit when the piece is wider than the door in every orientation', () => {
    const r = check(flat(0.7, 2.1, { width: 2.4, depth: 1.2, height: 1.1 }));
    expect(r.ok && r.fits).toBe(false);
    if (r.ok) {
      expect(r.bottleneck?.kind).toBe('opening');
      expect(r.message).toContain('Schätzung');
    }
  });

  it('reports a missing entrance', () => {
    const { p, id } = flat(0.9, 2.1, { width: 1, depth: 1, height: 1 });
    p.openings = [];
    expect(checkDelivery(p, derivePlan(p), id).ok).toBe(false);
  });
});
