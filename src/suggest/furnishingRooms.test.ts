import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '../model/factory';
import { addOpening, addRectRoom, closestWall } from '../model/operations';
import { derivePlan } from '../model/derived';
import { placementIssues } from '../model/placement';
import type { Furniture, Project } from '../model/schema';
import { applyFurnishing, defaultWishes, suggestFurnishing, suggestedIn, type RoomType, type WishItem } from './furnishing';

const T = 0.12;

/** One empty room with a clear interior 0..w × 0..d, a door in the south wall and a window in the north wall. */
function roomProject(w: number, d: number, name = 'Raum', window = true): Project {
  const p = createEmptyProject();
  addRectRoom(p, { x: 0, y: 0, width: w, depth: d, name, thickness: T, height: 2.6 });
  const south = closestWall(p, { x: 0.8, y: d + T / 2 }, 0.2);
  if (south) addOpening(p, south.wall.id, 'door', south.s);
  const north = window ? closestWall(p, { x: w / 2, y: -T / 2 }, 0.2) : null;
  if (north) addOpening(p, north.wall.id, 'window', north.s);
  return p;
}

function suggest(p: Project, type: RoomType, wishes: WishItem[] = defaultWishes(type)) {
  return suggestFurnishing(p, p.rooms.map((r) => ({ roomId: r.id, type, wishes })));
}

function expectCollisionFree(p: Project, items: Furniture[]) {
  const d = derivePlan(p);
  for (const f of items) expect(placementIssues(p, d, f).map((i) => `${f.name}: ${i.message}`)).toEqual([]);
}

const by = (items: Furniture[], id: string) => items.filter((f) => f.catalogId === id);

describe('furnishing per room type (#350)', () => {
  it('bath: washbasin, mirror above it, WC, shower, washing machine – mirror hangs, clear of the door', () => {
    const p = roomProject(2.6, 2.4, 'Bad', false);
    const s = suggest(p, 'bath');
    expect(s.rooms[0].missing).toEqual([]);
    const basin = by(s.items, 'generic-washbasin')[0];
    const mirror = by(s.items, 'generic-bath-mirror')[0];
    expect(basin && mirror && by(s.items, 'generic-washer')[0]).toBeTruthy();
    expect(mirror.elevation).toBeGreaterThan(1);
    expect(Math.hypot(mirror.x - basin.x, mirror.y - basin.y)).toBeLessThan(0.4);
    applyFurnishing(p, s);
    expectCollisionFree(p, s.items);
  });

  it('bedroom: the curtain hangs at the window, not on a wall beside it; wall art hangs', () => {
    const p = roomProject(4, 3.5, 'Schlafzimmer');
    const s = suggest(p, 'bedroom', [...defaultWishes('bedroom'), { catalogId: 'generic-curtain', quantity: 1 }]);
    const curtain = by(s.items, 'generic-curtain')[0];
    expect(curtain).toBeTruthy();
    // window in the middle of the north wall (y = 0)
    expect(Math.abs(curtain.y)).toBeLessThan(0.2);
    expect(Math.abs(curtain.x - 2)).toBeLessThan(0.3);
    expect(by(s.items, 'generic-picture')[0]?.elevation).toBeGreaterThan(1);
  });

  it('storeroom: shelves and broom cabinet at the walls, boxes on the shelf boards, vacuum has a place', () => {
    const p = roomProject(2.2, 1.8, 'Abstellraum', false);
    const s = suggest(p, 'utility');
    expect(by(s.items, 'generic-utility-shelf').length).toBeGreaterThan(0);
    expect(by(s.items, 'generic-vacuum')).toHaveLength(1);
    const boxes = by(s.items, 'generic-storage-box');
    expect(boxes.length).toBeGreaterThan(0);
    for (const b of boxes) expect(b.elevation, 'Box steht im Regal, nicht am Boden').toBeGreaterThan(0.05);
    applyFurnishing(p, s);
    expectCollisionFree(p, s.items.filter((f) => f.catalogId !== 'generic-storage-box'));
  });

  it('hall: shoe cabinet, coat rack near the door, mirror and picture – the walkway stays free', () => {
    const p = roomProject(1.6, 4.5, 'Gang', false);
    const s = suggest(p, 'hall');
    expect(s.rooms[0].missing).toEqual([]);
    expect(by(s.items, 'generic-coat-rack')[0].elevation).toBeGreaterThan(1);
    // nothing on the floor sticks out more than 0.7 m from a wall in a 1.6 m wide hall
    for (const f of s.items.filter((x) => x.elevation < 0.05)) expect(Math.min(f.x, 1.6 - f.x), f.name).toBeLessThan(0.45);
    applyFurnishing(p, s);
    expectCollisionFree(p, s.items);
  });

  it('balcony: table with two chairs and two planters', () => {
    const p = roomProject(3.2, 1.6, 'Balkon');
    const s = suggest(p, 'balcony');
    expect(s.rooms[0].missing).toEqual([]);
    expect(by(s.items, 'generic-balcony-chair')).toHaveLength(2);
    expect(by(s.items, 'generic-planter')).toHaveLength(2);
    applyFurnishing(p, s);
    expectCollisionFree(p, s.items);
  });

  it('living room: the large picture hangs above the sofa', () => {
    const p = roomProject(5, 4, 'Wohnzimmer');
    const s = suggest(p, 'living');
    const sofa = by(s.items, 'generic-sofa-3')[0];
    const pic = by(s.items, 'generic-picture-large')[0];
    expect(sofa && pic).toBeTruthy();
    expect(pic.elevation).toBeGreaterThan(1);
    expect(Math.hypot(pic.x - sofa.x, pic.y - sofa.y)).toBeLessThan(0.6);
  });

  it('a second preview replaces the furniture of the first one instead of adding it again', () => {
    const p = roomProject(4, 3.5, 'Schlafzimmer');
    const first = suggest(p, 'bedroom');
    applyFurnishing(p, first);
    const count = p.furniture.length;
    expect(p.furniture.every((f) => f.suggested)).toBe(true);
    const replace = suggestedIn(p, p.rooms.map((r) => r.id));
    expect(replace).toHaveLength(count);
    const again = suggestFurnishing(p, p.rooms.map((r) => ({ roomId: r.id, type: 'bedroom', wishes: defaultWishes('bedroom') })), undefined, { replace });
    expect(again.rooms[0].missing).toEqual([]);
    applyFurnishing(p, again);
    expect(p.furniture).toHaveLength(count);
  });
});
