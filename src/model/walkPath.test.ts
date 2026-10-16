import { describe, expect, it } from 'vitest';
import { createFurnitureFromCatalog } from '../catalog/instantiate';
import { findCatalogItem } from '../catalog/generic';
import { createEmptyProject } from './factory';
import { addOpening, addRectRoom, closestWall } from './operations';
import { derivePlan } from './derived';
import { createSampleProject } from './sample';
import { formatWalkLength, shortestWalkPath } from './walkPath';
import type { Project } from './schema';

const props = { thickness: 0.12, height: 2.6 };

function box(p: Project, catalogId: string, x: number, y: number, width: number, depth: number) {
  p.furniture.push({ ...createFurnitureFromCatalog(findCatalogItem(catalogId)!, { x, y }), x, y, width, depth, rotation: 0 });
}

/** two 4 × 3.5 m rooms side by side (interior x 0…4 and 4.12…8.12), shared wall at x = 4.06 */
function twoRooms(door: boolean) {
  const p = createEmptyProject();
  addRectRoom(p, { x: 0, y: 0, width: 4, depth: 3.5, name: 'A', ...props });
  addRectRoom(p, { x: 4.12, y: 0, width: 4, depth: 3.5, name: 'B', ...props });
  if (door) {
    const w = closestWall(p, { x: 4.06, y: 1.75 })!;
    addOpening(p, w.wall.id, 'door', w.s, { width: 0.9 });
  }
  return p;
}

const walk = (p: Project, a: { x: number; y: number }, b: { x: number; y: number }) => shortestWalkPath(p, derivePlan(p), a, b);

describe('shortest walking path (#67)', () => {
  it('is the straight line in an empty room', () => {
    const p = createEmptyProject();
    addRectRoom(p, { x: 0, y: 0, width: 6, depth: 4, name: 'R', ...props });
    const r = walk(p, { x: 1, y: 2 }, { x: 5, y: 2 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.points).toHaveLength(2);
    expect(r.length).toBeCloseTo(4, 6);
    expect(formatWalkLength(r.length)).toBe('4,00 m');
  });

  it('walks around furniture with a body clearance (longer than the straight line)', () => {
    const p = createEmptyProject();
    addRectRoom(p, { x: 0, y: 0, width: 6, depth: 4, name: 'R', ...props });
    box(p, 'generic-sideboard', 3, 2, 1, 2); // blocks the middle (y 1…3)
    const r = walk(p, { x: 1, y: 2 }, { x: 5, y: 2 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.length).toBeGreaterThan(4.3);
    expect(r.length).toBeLessThan(5.5);
    // never closer than ~25 cm to the cabinet (x 2.5…3.5, y 1…3)
    for (const q of r.points) if (q.x > 2.3 && q.x < 3.7) expect(q.y < 0.8 || q.y > 3.2).toBe(true);
  });

  it('goes through an open door into the next room', () => {
    const p = twoRooms(true);
    const r = walk(p, { x: 1, y: 1 }, { x: 7, y: 2.5 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.length).toBeGreaterThanOrEqual(Math.hypot(6, 1.5) - 1e-6);
    // passes the door gap (y 1.3…2.2 on the shared wall)
    const crossing = r.points.some((q, i) => i > 0 && (r.points[i - 1].x - 4.06) * (q.x - 4.06) <= 0 && Math.min(q.y, r.points[i - 1].y) < 2.2 && Math.max(q.y, r.points[i - 1].y) > 1.3);
    expect(crossing).toBe(true);
  });

  it('a closed door blocks – with a clear reason', () => {
    const p = twoRooms(true);
    p.openings[0].open = false;
    const r = walk(p, { x: 1, y: 1 }, { x: 7, y: 2.5 });
    expect(r).toEqual({ ok: false, reason: 'Kein Weg gefunden (blockiert durch eine geschlossene Tür)' });
    const noDoor = walk(twoRooms(false), { x: 1, y: 1 }, { x: 7, y: 2.5 });
    expect(noDoor.ok).toBe(false);
    if (!noDoor.ok) expect(noDoor.reason).toMatch(/blockiert durch Wände/);
  });

  it('furniture in the doorway blocks – reason names the furniture', () => {
    const p = twoRooms(true);
    box(p, 'generic-dresser', 3.6, 1.75, 0.6, 1.4); // right in front of the door
    const r = walk(p, { x: 1, y: 1 }, { x: 7, y: 2.5 });
    expect(r).toEqual({ ok: false, reason: 'Kein Weg gefunden (blockiert durch Möbel)' });
  });

  it('a rug does not block', () => {
    const p = createEmptyProject();
    addRectRoom(p, { x: 0, y: 0, width: 6, depth: 4, name: 'R', ...props });
    box(p, 'generic-rug-200', 3, 2, 2, 3);
    const r = walk(p, { x: 1, y: 2 }, { x: 5, y: 2 });
    expect(r.ok && r.length).toBeCloseTo(4, 6);
  });

  it('snaps a click on furniture or too close to a wall to the nearest walkable spot', () => {
    const p = createEmptyProject();
    addRectRoom(p, { x: 0, y: 0, width: 6, depth: 4, name: 'R', ...props });
    const r = walk(p, { x: 0.05, y: 2 }, { x: 5, y: 2 }); // 5 cm from the wall
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.points[0].x).toBeGreaterThanOrEqual(0.25);
    const outside = walk(p, { x: -3, y: 2 }, { x: 5, y: 2 });
    expect(outside).toEqual({ ok: false, reason: 'Kein Weg gefunden (Start liegt nicht in einem begehbaren Bereich)' });
  });

  it('sample apartment: living room → bedroom in well under 50 ms', () => {
    const p = createSampleProject();
    const d = derivePlan(p);
    shortestWalkPath(p, d, { x: 1, y: 1 }, { x: 7, y: 3 }); // warm-up
    const t0 = performance.now();
    const r = shortestWalkPath(p, d, { x: 1, y: 1 }, { x: 7, y: 3 });
    const ms = performance.now() - t0;
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.length).toBeGreaterThan(Math.hypot(6, 2));
    expect(ms).toBeLessThan(50);
  });
});
