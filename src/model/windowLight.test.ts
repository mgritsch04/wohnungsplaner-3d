import { describe, expect, it } from 'vitest';
import { createFurnitureFromCatalog } from '../catalog/instantiate';
import { findCatalogItem } from '../catalog/generic';
import { derivePlan } from './derived';
import { createEmptyProject } from './factory';
import { addOpening, addRectRoom, closestWall } from './operations';
import type { Project } from './schema';
import { apartmentDaylight, CURTAIN_TRANSMISSION, facadeFactor, windowLights } from './windowLight';

/** A 4 × 3 m room with a 1.4 m window in the upper (plan) wall; optionally a second, windowless room next to it. */
function flat(windowless = false): Project {
  const p = createEmptyProject('Test');
  addRectRoom(p, { x: 0, y: 0, width: 4, depth: 3, name: 'Wohnzimmer', thickness: 0.12, height: 2.6 });
  if (windowless) addRectRoom(p, { x: 4.12, y: 0, width: 2, depth: 3, name: 'Abstellraum', thickness: 0.12, height: 2.6 });
  const w = closestWall(p, { x: 2, y: -0.06 }, 0.2)!;
  addOpening(p, w.wall.id, 'window', w.s, { width: 1.4 });
  return p;
}
const curtain = (p: Project, x: number, closed: number | undefined, width = 1.6) => {
  const c = createFurnitureFromCatalog(findCatalogItem('generic-curtain')!, { x, y: 0.15, rotation: 0 });
  c.width = width;
  c.closed = closed;
  p.furniture.push(c);
  return c;
};

describe('daylight through windows (#420)', () => {
  it('finds the window, the room it lights and the direction it faces', () => {
    const p = flat(true);
    const ws = windowLights(p, derivePlan(p));
    expect(ws).toHaveLength(1);
    expect(ws[0].roomId).toBe(p.rooms[0].id);
    expect(ws[0].glass).toBeGreaterThan(1);
    expect(ws[0].transmission).toBe(1);
    expect(ws[0].bearing).toBeCloseTo(0); // plan up = north by default
    p.settings.northDirection = 180;
    expect(windowLights(p, derivePlan(p))[0].bearing).toBeCloseTo(180);
  });

  it('a closed curtain dims the window, an open one (gathered at the side) hardly', () => {
    const p = flat();
    const c = curtain(p, 2, 1);
    expect(windowLights(p, derivePlan(p))[0].transmission).toBeCloseTo(CURTAIN_TRANSMISSION, 2);
    c.closed = 0.5;
    const half = windowLights(p, derivePlan(p))[0].transmission;
    expect(half).toBeGreaterThan(CURTAIN_TRANSMISSION + 0.1);
    expect(half).toBeLessThan(0.8);
    c.closed = undefined;
    expect(windowLights(p, derivePlan(p))[0].transmission).toBeGreaterThan(0.8);
  });

  it('a curtain elsewhere in the room does not count', () => {
    const p = flat();
    const c = curtain(p, 2, 1);
    c.y = 2;
    expect(windowLights(p, derivePlan(p))[0].transmission).toBe(1);
  });

  it('blinds on the window and the running simulation are taken into account', () => {
    const p = flat();
    const o = p.openings[0];
    o.shading = { type: 'roller', closed: 1, motor: true };
    expect(windowLights(p, derivePlan(p))[0].transmission).toBeLessThan(0.05);
    const sim = { openings: new Map([[o.id, 0]]), furniture: new Map<string, number>() };
    expect(windowLights(p, derivePlan(p), sim)[0].transmission).toBe(1);
  });

  it('the apartment gets darker the less glass lets light in', () => {
    const p = flat(true);
    const open = apartmentDaylight(p, derivePlan(p), windowLights(p, derivePlan(p)));
    p.openings[0].shading = { type: 'roller', closed: 1, motor: false };
    const shut = apartmentDaylight(p, derivePlan(p), windowLights(p, derivePlan(p)));
    expect(open).toBeGreaterThan(0.3);
    expect(shut).toBeLessThan(0.05);
    const noWindows = createEmptyProject('x');
    addRectRoom(noWindows, { x: 0, y: 0, width: 3, depth: 3, name: 'Bad', thickness: 0.12, height: 2.6 });
    expect(apartmentDaylight(noWindows, derivePlan(noWindows), [])).toBe(0);
  });

  it('a window facing the sun gets more light than one on the shaded side', () => {
    expect(facadeFactor(180, 180, 1)).toBeGreaterThan(facadeFactor(0, 180, 1));
    expect(facadeFactor(0, 180, 0)).toBeCloseTo(facadeFactor(180, 180, 0));
  });
});
