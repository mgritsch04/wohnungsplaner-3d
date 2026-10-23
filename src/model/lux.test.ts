import { describe, expect, it } from 'vitest';
import { createFurnitureFromCatalog } from '../catalog/instantiate';
import { findCatalogItem } from '../catalog/generic';
import { derivePlan } from './derived';
import { createEmptyProject } from './factory';
import { computeLux, roomAdvice, roomTarget } from './lux';
import { addOpening, addRectRoom, closestWall } from './operations';
import type { Project } from './schema';

function room(name = 'Arbeitszimmer', window = true): Project {
  const p = createEmptyProject('Test');
  addRectRoom(p, { x: 0, y: 0, width: 4, depth: 3, name, thickness: 0.12, height: 2.6 });
  if (window) {
    const w = closestWall(p, { x: 2, y: -0.06 }, 0.2);
    if (w) addOpening(p, w.wall.id, 'window', w.s, { width: 1.4 });
  }
  return p;
}
const place = (p: Project, id: string, x: number, y: number) => {
  const item = findCatalogItem(id)!;
  const f = createFurnitureFromCatalog(item, { x, y });
  p.furniture.push(f);
  return f;
};
const lux = (p: Project, mode: 'evening' | 'day' = 'evening') => computeLux(p, derivePlan(p), mode);

describe('Lux-Lichtkarte (#360)', () => {
  it('ohne Lampe und ohne Tageslicht ist ein Schreibtisch zu dunkel', () => {
    const p = room();
    place(p, 'generic-desk', 2, 1.5);
    const r = lux(p);
    expect(r.surfaces).toHaveLength(1);
    expect(r.surfaces[0].status).toBe('dark');
    expect(r.surfaces[0].lux).toBe(0);
    expect(r.rooms[0].lampCount).toBe(0);
    expect(roomAdvice(r.rooms[0])).toContain('Keine Lampe');
  });

  it('eine Tischlampe über dem Schreibtisch erreicht den Richtwert, eine Pendelleuchte allein nicht', () => {
    const p = room();
    place(p, 'generic-desk', 2, 1.5);
    place(p, 'generic-pendant', 2, 1.5);
    expect(lux(p).surfaces[0].status).not.toBe('ok');
    place(p, 'generic-table-lamp', 2.2, 1.5).lumen = 800;
    const r = lux(p);
    expect(r.surfaces[0].status).toBe('ok');
    expect(r.surfaces[0].lux).toBeGreaterThanOrEqual(500);
  });

  it('stärkere Lampe gibt mehr Licht, eigener Lichtstrom zählt', () => {
    const p = room();
    const lamp = place(p, 'generic-floor-lamp', 2, 1.5);
    const a = lux(p).rooms[0].lux;
    lamp.lumen = 1600;
    expect(lux(p).rooms[0].lux).toBeGreaterThan(a * 1.9);
  });

  it('Lampe in einem anderen Raum zählt nicht', () => {
    const p = room();
    place(p, 'generic-floor-lamp', 9, 9);
    expect(lux(p).rooms[0].lux).toBe(0);
  });

  it('Tageslicht hellt Räume mit Fenster auf, nur im Tagesmodus', () => {
    const p = room();
    expect(lux(p, 'evening').rooms[0].lux).toBe(0);
    const day = lux(p, 'day').rooms[0].lux;
    expect(day).toBeGreaterThan(20);
    expect(day).toBeLessThan(1000);
    expect(lux(room('Arbeitszimmer', false), 'day').rooms[0].lux).toBe(0);
  });

  it('Empfehlung nennt fehlenden Lichtstrom, bei genug Lampen nichts', () => {
    const p = room('Schlafzimmer');
    place(p, 'generic-table-lamp', 2, 1.5);
    const r = lux(p).rooms[0];
    expect(roomAdvice(r)).toContain('noch etwa');
    for (let i = 0; i < 4; i++) place(p, 'generic-floor-lamp', 1 + i * 0.3, 1);
    expect(roomAdvice(lux(p).rooms[0])).toBeNull();
  });

  it('Richtwerte nach Raumname', () => {
    expect(roomTarget('Küche').lux).toBe(300);
    expect(roomTarget('Bad').lux).toBe(200);
    expect(roomTarget('Schlafzimmer').lux).toBe(100);
  });
});
