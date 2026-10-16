import { describe, expect, it } from 'vitest';
import { createEmptyProject } from './factory';
import { addOpening, addRectRoom, closestWall } from './operations';
import { derivePlan } from './derived';
import { createSampleProject } from './sample';
import { defaultViewpoint, sightArea, sightFrom } from './visibility';
import { pointInPolygon } from './vec';
import type { Project } from './schema';

const props = { thickness: 0.12, height: 2.6 };

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
const sight = (p: Project, x: number, y: number) => sightFrom(p, derivePlan(p), { x, y });

describe('sight lines (#89)', () => {
  it('an empty room is completely visible', () => {
    const p = createEmptyProject();
    addRectRoom(p, { x: 0, y: 0, width: 6, depth: 4, name: 'R', ...props });
    const r = sight(p, 1.5, 1);
    expect(r.share).toBe(1);
    expect(sightArea(r)).toBeCloseTo(24, 3); // stops exactly at the inner wall faces
  });

  it('a wall in between hides the other room', () => {
    const r = sight(twoRooms(false), 2, 1.75);
    expect(r.share).toBeCloseTo(0.5, 2);
    expect(pointInPolygon({ x: 6, y: 1.75 }, r.polygon)).toBe(false);
  });

  it('an open door lets the view through – a closed one does not', () => {
    const p = twoRooms(true);
    const open = sight(p, 2, 1.75);
    expect(open.share).toBeGreaterThan(0.55);
    expect(pointInPolygon({ x: 7, y: 1.75 }, open.polygon)).toBe(true); // straight through the doorway
    expect(pointInPolygon({ x: 7.8, y: 0.2 }, open.polygon)).toBe(false); // corner of B, out of sight
    p.openings[0].open = false;
    const closed = sight(p, 2, 1.75);
    expect(closed.share).toBeCloseTo(0.5, 2);
  });

  it('defaults to the entrance: just inside the outer door of the sample apartment', () => {
    const p = createSampleProject();
    const d = derivePlan(p);
    const v = defaultViewpoint(p, d)!;
    const living = [...d.rooms.values()].find((g) => p.rooms.find((r) => r.id === g.roomId)?.name === 'Wohnzimmer')!;
    expect(pointInPolygon(v, living.interior)).toBe(true);
    expect(v.y).toBeCloseTo(4 - 0.3, 1); // 30 cm inside the south wall face (y = 4)
    expect(defaultViewpoint(createEmptyProject(), derivePlan(createEmptyProject()))).toBeNull();
  });

  it('stays well below one frame for the sample apartment', () => {
    const p = createSampleProject();
    const d = derivePlan(p);
    const v = defaultViewpoint(p, d)!;
    sightFrom(p, d, v); // warm-up
    const t0 = performance.now();
    const runs = 5;
    let share = 0;
    for (let i = 0; i < runs; i++) share = sightFrom(p, d, { x: v.x + i * 0.1, y: v.y }).share;
    const ms = (performance.now() - t0) / runs;
    expect(share).toBeGreaterThan(0);
    expect(share).toBeLessThan(1);
    expect(ms).toBeLessThan(16);
  });
});
