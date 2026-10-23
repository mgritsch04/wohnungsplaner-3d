import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '../model/factory';
import { addOpening, addRectRoom, closestWall } from '../model/operations';
import { derivePlan } from '../model/derived';
import { pointInPolygon } from '../model/vec';
import { rectPoints } from '../model/zones';
import { createFurnitureFromCatalog } from '../catalog/instantiate';
import { findCatalogItem } from '../catalog/generic';
import { guessRoomType } from '../suggest/furnishing';
import { kitchenFaces, kitchenPromptPart, parseKitchen, placeKitchen, plannedKitchenRooms, resolveWith } from './kitchenDesign';

/** Open kitchen and living room 8 × 3.6 m (one room, no wall between), balcony door at the far end. */
function openPlan() {
  const p = createEmptyProject();
  addRectRoom(p, { x: 0, y: 0, width: 8, depth: 3.6, name: 'Küche / Wohnzimmer', thickness: 0.12, height: 2.6 });
  const east = closestWall(p, { x: 8.06, y: 1.8 }, 0.2);
  if (east) addOpening(p, east.wall.id, 'door', east.s);
  return p;
}

const ROW_SINK = [{ catalogId: 'generic-k-fridge' }, { catalogId: 'generic-k-sink-80' }, { catalogId: 'generic-k-dishwasher' }];
const ROW_COOK = [
  { catalogId: 'generic-k-oven', above: [{ catalogId: 'generic-k-cooktop' }, { catalogId: 'generic-k-hood-60' }] },
  { catalogId: 'generic-k-base-60', above: [{ catalogId: 'generic-k-wall-60' }] },
  { catalogId: 'generic-k-base-60', above: [{ catalogId: 'generic-k-wall-60' }] },
];
const kitchen = () => parseKitchen({ frontColor: '#ffffff', runs: [ROW_SINK, ROW_COOK] }).kitchen!;
const floorOf = (items: ReturnType<typeof placeKitchen>['items']) => items.filter((f) => f.kitchen && !['wall', 'hood', 'cooktop', 'countertop'].includes(f.kitchen.type));

describe('one kitchen per flat, in the marked kitchen area', () => {
  it('keeps both rows inside the area marked „Küche“', () => {
    const p = openPlan();
    const zone = rectPoints({ x: 0, y: 0 }, { x: 3, y: 3.6 });
    p.zones.push({ id: 'zk', purpose: 'Küche', points: zone });
    const id = p.rooms[0].id;
    const faces = kitchenFaces(p, id);
    expect(faces.length).toBeGreaterThan(0);
    // only the walls in the area, the long walls only up to its end
    expect(Math.max(...faces.map((f) => f.length))).toBeLessThan(3.8);
    expect(kitchenPromptPart(faces).join('\n')).toContain('markierten Bereich Z1');

    const { items } = placeKitchen(p, id, kitchen(), resolveWith([]));
    expect(floorOf(items).length).toBeGreaterThanOrEqual(4);
    for (const f of items) expect(f.x).toBeLessThan(3.3);
    expect(items.some((f) => f.kitchen?.type === 'cooktop')).toBe(true);
  });

  it('does not put the second row at a distant wall of an open room', () => {
    const p = openPlan();
    const { items, missing } = placeKitchen(p, p.rooms[0].id, kitchen(), resolveWith([]));
    const floor = floorOf(items);
    expect(floor.length).toBeGreaterThan(0);
    // every module is near another one: one kitchen, not two at opposite ends
    for (const f of floor) expect(floor.some((g) => g !== f && Math.hypot(g.x - f.x, g.y - f.y) < 2.3)).toBe(true);
    const xs = floor.map((f) => f.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(4.5);
    expect(missing.length + floor.length).toBeGreaterThanOrEqual(6);
  });

  it('keeps the kitchen out of other marked areas', () => {
    const p = openPlan();
    const dining = rectPoints({ x: 0, y: 0 }, { x: 3, y: 3.6 });
    p.zones.push({ id: 'ze', purpose: 'Essbereich', points: dining });
    const { items } = placeKitchen(p, p.rooms[0].id, kitchen(), resolveWith([]));
    for (const f of items) expect(pointInPolygon(f, dining)).toBe(false);
  });

  it('plans at most one kitchen: the room with the kitchen area wins, an existing kitchen means none', () => {
    const p = createEmptyProject();
    addRectRoom(p, { x: 0, y: 0, width: 3, depth: 3, name: 'Küche', thickness: 0.12, height: 2.6 });
    addRectRoom(p, { x: 3, y: 0, width: 5, depth: 4, name: 'Wohnküche', thickness: 0.12, height: 2.6 });
    addRectRoom(p, { x: 8, y: 0, width: 4, depth: 4, name: 'Wohnzimmer', thickness: 0.12, height: 2.6 });
    const [k, wk, wz] = p.rooms.map((r) => r.id);
    const ids = [k, wk, wz];
    const typeOf = (id: string) => guessRoomType(p.rooms.find((r) => r.id === id)!.name);
    // two rooms called kitchen: only the first gets a kitchen run
    expect(plannedKitchenRooms(p, ids, typeOf, {})).toEqual([k]);
    // a kitchen area marked in the living room: the kitchen goes there, nowhere else
    p.zones.push({ id: 'z', purpose: 'Küchenzeile', points: rectPoints({ x: 8.2, y: 0.2 }, { x: 10, y: 1.5 }) });
    expect(plannedKitchenRooms(p, ids, typeOf, {})).toEqual([wz]);
    // several rooms set to „Küche“ by the user: an explicit wish for several kitchens
    expect(plannedKitchenRooms(p, ids, typeOf, { [k]: 'kitchen', [wk]: 'kitchen' })).toEqual([k, wk]);
    // the flat already has a kitchen run: no further one
    p.zones = [];
    const sink = createFurnitureFromCatalog(findCatalogItem('generic-k-sink-80')!, { x: 1.5, y: 0.4, rotation: 0 });
    p.furniture.push(sink);
    derivePlan(p);
    expect(plannedKitchenRooms(p, ids, typeOf, {})).toEqual([]);
  });
});
