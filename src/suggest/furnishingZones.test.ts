import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '../model/factory';
import { addRectRoom } from '../model/operations';
import type { Furniture, Project } from '../model/schema';
import { furnitureCorners } from '../editor2d/furnitureGeometry';
import { polygonInside, polygonsOverlap, rectPoints } from '../model/zones';
import { suggestFurnishing, type WishItem } from './furnishing';

function room(): Project {
  const p = createEmptyProject();
  addRectRoom(p, { x: 0, y: 0, width: 5, depth: 4, name: 'Wohnzimmer', thickness: 0.12, height: 2.6 });
  return p;
}

const suggest = (p: Project, wishes: WishItem[]) => suggestFurnishing(p, [{ roomId: p.rooms[0].id, type: 'living', wishes }]);
const inside = (f: Furniture, pts: { x: number; y: number }[]) => polygonInside(furnitureCorners(f), pts);

describe('furnishing with marked areas (#416)', () => {
  it('furniture of a zone stands inside it, everything else stays out', () => {
    const p = room();
    const work = rectPoints({ x: 3.2, y: 2.2 }, { x: 5, y: 4 });
    p.zones.push({ id: 'z1', purpose: 'Arbeitsecke', points: work });
    const s = suggest(p, [
      { catalogId: 'generic-desk', quantity: 1, zoneId: 'z1' },
      { catalogId: 'generic-office-chair', quantity: 1, zoneId: 'z1' },
      { catalogId: 'generic-sofa-3', quantity: 1 },
      { catalogId: 'generic-coffee-table', quantity: 1 },
    ]);
    expect(s.rooms[0].missing).toEqual([]);
    const desk = s.items.find((f) => f.catalogId === 'generic-desk')!;
    const chair = s.items.find((f) => f.catalogId === 'generic-office-chair')!;
    expect(inside(desk, work)).toBe(true);
    expect(inside(chair, work)).toBe(true);
    for (const f of s.items.filter((x) => x !== desk && x !== chair)) expect(polygonsOverlap(furnitureCorners(f), work)).toBe(false);
  });

  it('a „frei lassen“ zone stays empty; a piece that does not fit its zone is reported, not placed elsewhere', () => {
    const p = room();
    const free = rectPoints({ x: 0, y: 0 }, { x: 5, y: 2.6 });
    p.zones.push({ id: 'z1', purpose: 'frei lassen', points: free }, { id: 'z2', purpose: 'Leseplatz', points: rectPoints({ x: 4, y: 3 }, { x: 5, y: 4 }) });
    const s = suggest(p, [
      { catalogId: 'generic-sofa-3', quantity: 1, zoneId: 'z2' },
      { catalogId: 'generic-floor-lamp', quantity: 1 },
    ]);
    expect(s.items.some((f) => polygonsOverlap(furnitureCorners(f), free))).toBe(false);
    expect(s.rooms[0].missing).toContain(s.rooms[0].notes!.find((n) => n.why.includes('Leseplatz'))?.name);
    expect(s.items.some((f) => f.catalogId === 'generic-sofa-3')).toBe(false);
  });

  it('without zones nothing changes', () => {
    const p = room();
    const a = suggest(p, [{ catalogId: 'generic-sofa-3', quantity: 1 }]);
    expect(a.items).toHaveLength(1);
  });
});
