import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '../model/factory';
import { addOpening, addRectRoom, closestWall } from '../model/operations';
import { derivePlan } from '../model/derived';
import { placementIssues } from '../model/placement';
import { createSampleProject } from '../model/sample';
import type { Project } from '../model/schema';
import { furnitureCorners } from '../editor2d/furnitureGeometry';
import { pointInPolygon } from '../model/vec';
import { applyFurnishing, defaultWishes, guessRoomType, suggestFurnishing, suggestionTotal, wishesForRoom, type RoomType } from './furnishing';

const T = 0.12;

/** One empty room with a clear interior 0..w × 0..d, a door in the south wall and a window in the north wall. */
function roomProject(w: number, d: number, name = 'Raum'): Project {
  const p = createEmptyProject();
  addRectRoom(p, { x: 0, y: 0, width: w, depth: d, name, thickness: T, height: 2.6 });
  const south = closestWall(p, { x: 0.8, y: d + T / 2 }, 0.2);
  if (south) addOpening(p, south.wall.id, 'door', south.s);
  const north = closestWall(p, { x: w / 2, y: -T / 2 }, 0.2);
  if (north) addOpening(p, north.wall.id, 'window', north.s);
  return p;
}

function suggest(p: Project, type: RoomType) {
  return suggestFurnishing(p, p.rooms.map((r) => ({ roomId: r.id, type, wishes: defaultWishes(type) })));
}

/** After applying: none of the proposed items has a placement issue (walls, doors, overlaps, clearance). */
function expectCollisionFree(p: Project, ids: string[]) {
  const d = derivePlan(p);
  for (const id of ids) {
    const f = p.furniture.find((x) => x.id === id)!;
    expect(placementIssues(p, d, f).map((i) => `${f.name}: ${i.message}`)).toEqual([]);
    const g = [...d.rooms.values()].find((r) => pointInPolygon({ x: f.x, y: f.y }, r.interior))!;
    expect(g, `${f.name} steht in einem Raum`).toBeTruthy();
    // corners pulled in by 3 mm: flush against a wall counts as inside
    for (const c of furnitureCorners(f)) expect(pointInPolygon({ x: c.x + Math.sign(f.x - c.x) * 0.003, y: c.y + Math.sign(f.y - c.y) * 0.003 }, g.interior), `${f.name} im Raum`).toBe(true);
  }
}

describe('room type from name (#137)', () => {
  it('recognises common German room names', () => {
    expect(guessRoomType('Wohnzimmer')).toBe('living');
    expect(guessRoomType('Schlafzimmer')).toBe('bedroom');
    expect(guessRoomType('Kinderzimmer')).toBe('kids');
    expect(guessRoomType('Wohnküche')).toBe('kitchen');
    expect(guessRoomType('Badezimmer')).toBe('bath');
    expect(guessRoomType('Flur')).toBe('hall');
    expect(guessRoomType('Büro')).toBe('office');
    expect(guessRoomType('Abstellraum')).toBe('other');
  });
});

describe('furnishing suggestion (#137)', () => {
  it('bedroom: bed against the longest wall, nightstands beside it, lamps on them, wardrobe – all collision free', () => {
    const p = roomProject(4, 3.5, 'Schlafzimmer');
    const s = suggest(p, 'bedroom');
    expect(s.rooms[0].missing).toEqual([]);
    const names = s.items.map((f) => f.name);
    expect(names).toEqual(expect.arrayContaining(['Doppelbett 160×200', 'Nachttisch', 'Tischlampe', 'Kleiderschrank 150 cm']));
    const bed = s.items.find((f) => f.category === 'bed' && f.name.startsWith('Doppelbett'))!;
    // back against a 4 m wall (north or south): headboard edge touches y≈0 or y≈3.5
    const backY = bed.y - Math.cos(bed.rotation) * (bed.depth / 2);
    expect(Math.min(Math.abs(backY), Math.abs(backY - 3.5))).toBeLessThan(0.03);
    const stands = s.items.filter((f) => f.name === 'Nachttisch');
    expect(stands).toHaveLength(2);
    for (const n of stands) expect(Math.abs(Math.hypot(n.x - bed.x, n.y - bed.y))).toBeLessThan(1.4);
    const lamps = s.items.filter((f) => f.name === 'Tischlampe');
    for (const l of lamps) expect(l.elevation).toBeCloseTo(0.5, 3);
    const ids = applyFurnishing(p, s);
    expectCollisionFree(p, ids);
  });

  it('living room: coffee table in front of the sofa, TV board opposite, rug under the coffee table', () => {
    const p = roomProject(5, 4, 'Wohnzimmer');
    const s = suggest(p, 'living');
    const sofa = s.items.find((f) => f.name === 'Sofa 3-Sitzer')!;
    const ct = s.items.find((f) => f.name === 'Couchtisch')!;
    const board = s.items.find((f) => f.name === 'TV-Lowboard')!;
    expect(sofa && ct && board).toBeTruthy();
    const fwd = { x: -Math.sin(sofa.rotation), y: Math.cos(sofa.rotation) };
    // coffee table lies in front of the sofa, the TV board further along the same direction
    expect((ct.x - sofa.x) * fwd.x + (ct.y - sofa.y) * fwd.y).toBeGreaterThan(0.5);
    expect((board.x - sofa.x) * fwd.x + (board.y - sofa.y) * fwd.y).toBeGreaterThan(2);
    const rug = s.items.find((f) => f.category === 'textile');
    if (rug) expect(Math.hypot(rug.x - ct.x, rug.y - ct.y)).toBeLessThan(0.01);
    const tv = s.items.find((f) => f.name.startsWith('Fernseher'));
    if (tv) expect(Math.hypot(tv.x - board.x, tv.y - board.y)).toBeLessThan(0.3);
    expectCollisionFree(p, applyFurnishing(p, s));
  });

  it('dining room: chairs around the table, pendant above it', () => {
    const p = roomProject(4, 4, 'Esszimmer');
    const s = suggest(p, 'dining');
    const table = s.items.find((f) => f.category === 'table')!;
    const chairs = s.items.filter((f) => f.category === 'chair');
    expect(chairs.length).toBeGreaterThanOrEqual(4);
    for (const c of chairs) expect(Math.hypot(c.x - table.x, c.y - table.y)).toBeLessThan(1.4);
    const pendant = s.items.find((f) => f.name === 'Pendelleuchte')!;
    expect([pendant.x, pendant.y]).toEqual([table.x, table.y]);
    expectCollisionFree(p, applyFurnishing(p, s));
  });

  it('bathroom and office are collision free; items that do not fit are reported, not forced in', () => {
    for (const [type, w, d] of [['bath', 2.4, 2], ['office', 3, 3]] as const) {
      const p = roomProject(w, d);
      const s = suggest(p, type);
      expect(s.items.length).toBeGreaterThan(2);
      expectCollisionFree(p, applyFurnishing(p, s));
    }
    const tiny = roomProject(1.2, 1.2);
    const s = suggest(tiny, 'bedroom');
    expect(s.rooms[0].missing).toContain('Doppelbett 160×200');
    expectCollisionFree(tiny, applyFurnishing(tiny, s));
  });

  it('respects existing furniture and keeps doors free (sample apartment, whole flat)', () => {
    const p = createSampleProject();
    const before = p.furniture.length;
    const reqs = p.rooms.map((r) => ({ roomId: r.id, type: guessRoomType(r.name), wishes: [{ catalogId: 'generic-shelf-80', quantity: 2 }, { catalogId: 'generic-plant', quantity: 1 }] }));
    const s = suggestFurnishing(p, reqs);
    expect(s.rooms).toHaveLength(2);
    expect(p.furniture).toHaveLength(before); // nothing changed before applying
    const ids = applyFurnishing(p, s);
    expect(p.furniture).toHaveLength(before + ids.length);
    expectCollisionFree(p, ids);
  });

  it('wish list subtracts what already stands in the room; total sums guide prices', () => {
    const p = createSampleProject();
    const d = derivePlan(p);
    const bedroom = p.rooms.find((r) => r.name === 'Schlafzimmer')!;
    const w = wishesForRoom(p, d, bedroom.id, 'bedroom');
    expect(w.find((x) => x.catalogId === 'generic-bed-160')?.quantity).toBe(0);
    expect(w.find((x) => x.catalogId === 'generic-nightstand')?.quantity).toBe(0);
    expect(w.find((x) => x.catalogId === 'generic-dresser')?.quantity).toBe(1);
    const s = suggestFurnishing(p, [{ roomId: bedroom.id, type: 'bedroom', wishes: [{ catalogId: 'generic-dresser', quantity: 1 }] }]);
    expect(suggestionTotal(s)).toBe(s.items.length ? 160 : 0);
  });
});
