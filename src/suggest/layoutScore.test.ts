import { describe, expect, it } from 'vitest';
import { findCatalogItem } from '../catalog/generic';
import { createFurnitureFromCatalog } from '../catalog/instantiate';
import { createEmptyProject } from '../model/factory';
import { addOpening, addRectRoom, closestWall } from '../model/operations';
import { derivePlan } from '../model/derived';
import { placementIssues } from '../model/placement';
import type { Furniture, Project } from '../model/schema';
import { dot, normalize, sub } from '../model/vec';
import { suggestFurnishing, type RoomType } from './furnishing';
import { scoreRoom } from './layoutScore';
import { frontOf } from './roomGeometry';

const T = 0.12;

/** Empty room 0..w × 0..d, door in the south wall near the west corner, windows at the given points of the walls. */
function room(w: number, d: number, windows: { x: number; y: number }[] = [{ x: w / 2, y: -T / 2 }]): Project {
  const p = createEmptyProject();
  addRectRoom(p, { x: 0, y: 0, width: w, depth: d, name: 'Raum', thickness: T, height: 2.6 });
  const south = closestWall(p, { x: 0.8, y: d + T / 2 }, 0.2);
  if (south) addOpening(p, south.wall.id, 'door', south.s);
  for (const pt of windows) {
    const h = closestWall(p, pt, 0.2);
    if (h) addOpening(p, h.wall.id, 'window', h.s);
  }
  return p;
}

const put = (p: Project, id: string, x: number, y: number, rotation = 0, elevation?: number): Furniture => {
  const f = createFurnitureFromCatalog(findCatalogItem(id)!, { x, y, rotation });
  if (elevation !== undefined) f.elevation = elevation;
  p.furniture.push(f);
  return f;
};

const texts = (p: Project, type: RoomType) => scoreRoom(p, p.rooms[0].id, type).issues.map((i) => i.text);
const it_ = (catalogId: string, quantity = 1) => ({ catalogId, quantity });

describe('scoreLayout (#350)', () => {
  it('finds a bed with its head under the window, not one at a closed wall', () => {
    const p = room(4, 3.5);
    // head against the north wall (window), foot into the room
    put(p, 'generic-bed-160', 2, 1.05, 0);
    expect(texts(p, 'bedroom').join()).toContain('Kopfteil unter dem Fenster');
    const q = room(4, 3.5);
    // head against the east wall (closed)
    put(q, 'generic-bed-160', 4 - 1.05, 1.6, Math.PI / 2);
    expect(texts(q, 'bedroom').join()).not.toContain('Fenster');
  });

  it('finds a TV beside instead of opposite the sofa, and a wardrobe lost in the middle of the room', () => {
    const p = room(5, 4, []);
    put(p, 'generic-sofa-3', 2.5, 0.46, 0);
    put(p, 'generic-tv-sideboard', 0.22, 2.5, -Math.PI / 2);
    put(p, 'generic-wardrobe-100', 2.5, 2.2, 0);
    const t = texts(p, 'living').join();
    expect(t).toContain('nicht gegenüber vom Sofa');
    expect(t).toContain('Kleiderschrank 100 cm steht frei im Raum');
    expect(scoreRoom(p, p.rooms[0].id, 'living').score).toBeLessThan(85);
  });

  it('counts pieces without a place and blocked ways', () => {
    const p = room(3, 3, []);
    // a wardrobe right behind the door: its front cannot be reached
    put(p, 'generic-wardrobe-150', 0.8, 3 - 0.95, Math.PI);
    put(p, 'generic-sideboard', 0.8, 3 - 1.6, 0);
    const s = scoreRoom(p, p.rooms[0].id, 'bedroom', 2);
    expect(s.issues[0]).toEqual({ penalty: 24, text: '2 Möbel haben keinen Platz gefunden' });
  });
});

describe('placement picks the best arrangement (#350)', () => {
  const living = [it_('generic-sofa-3'), it_('generic-coffee-table'), it_('generic-tv-sideboard'), it_('generic-tv'), it_('generic-armchair'), it_('generic-floor-lamp'), it_('generic-picture-large'), it_('generic-rug-200')];

  it('living room with windows on one long wall: sofa and TV face each other across the room, neither in front of a window, no picture over the TV', () => {
    const p = room(5, 4);
    const s = suggestFurnishing(p, [{ roomId: p.rooms[0].id, type: 'living', wishes: living }]);
    expect(s.rooms[0].missing).toEqual([]);
    const sofa = s.items.find((f) => f.catalogId === 'generic-sofa-3')!;
    const tv = s.items.find((f) => f.catalogId === 'generic-tv')!;
    expect(dot(normalize(sub(tv, sofa)), frontOf(sofa))).toBeGreaterThan(0.95);
    const pic = s.items.find((f) => f.catalogId === 'generic-picture-large')!;
    expect(Math.hypot(pic.x - tv.x, pic.y - tv.y)).toBeGreaterThan(0.5);
    p.furniture.push(...s.items);
    const t = texts(p, 'living').join();
    expect(t).not.toContain('Fenster');
    expect(s.rooms[0].score!.score).toBeGreaterThanOrEqual(90);
    const d = derivePlan(p);
    for (const f of s.items) expect(placementIssues(p, d, f).map((i) => `${f.name}: ${i.message}`)).toEqual([]);
  });

  it('kids room: the single bed lies with its long side against a wall, so wardrobe, desk and chair still fit', () => {
    const p = room(2.9, 3.0, [{ x: 2.9 + T / 2, y: 1.5 }]);
    const s = suggestFurnishing(p, [{ roomId: p.rooms[0].id, type: 'kids', wishes: [it_('generic-bed-90'), it_('generic-wardrobe-100'), it_('generic-desk-small'), it_('generic-office-chair'), it_('generic-rug-160')] }]);
    expect(s.rooms[0].missing).toEqual([]);
    const bed = s.items.find((f) => f.catalogId === 'generic-bed-90')!;
    p.furniture.push(...s.items);
    expect(texts(p, 'kids').join()).not.toContain('Einzelbett 90×200 steht frei');
    // long side (2.05 m) along the wall: its centre is half a bed width from a wall
    const g = derivePlan(p).rooms.get(p.rooms[0].id)!;
    const xs = g.interior.map((q) => q.x);
    const ys = g.interior.map((q) => q.y);
    const gaps = [bed.x - Math.min(...xs), Math.max(...xs) - bed.x, bed.y - Math.min(...ys), Math.max(...ys) - bed.y];
    expect(gaps.some((v) => Math.abs(v - bed.width / 2) < 0.05)).toBe(true);
  });

  it('bedroom: the rug lies crosswise under the lower part of the bed', () => {
    const p = room(4, 3.5);
    const s = suggestFurnishing(p, [{ roomId: p.rooms[0].id, type: 'bedroom', wishes: [it_('generic-bed-160'), it_('generic-nightstand', 2), it_('generic-rug-160')] }]);
    const bed = s.items.find((f) => f.catalogId === 'generic-bed-160')!;
    const rug = s.items.find((f) => f.catalogId === 'generic-rug-160')!;
    const ahead = dot(sub(rug, bed), frontOf(bed));
    expect(ahead).toBeGreaterThan(0.2);
    expect(ahead).toBeLessThan(1);
    // the rug's long side runs across the bed
    expect(Math.abs(Math.cos(rug.rotation - bed.rotation))).toBeLessThan(0.1);
  });
});
