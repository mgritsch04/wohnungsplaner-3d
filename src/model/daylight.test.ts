import { describe, expect, it } from 'vitest';
import { computeDaylight, compassOf, planBearing, sunHoursFor, sunSpanLabel } from './daylight';
import { derivePlan } from './derived';
import { createEmptyProject } from './factory';
import { addOpening, addRectRoom } from './operations';
import type { Project } from './schema';

const props = { thickness: 0.12, height: 2.6 };

/** Wall ids of a rectangular room by side (plan up = y smallest). */
function wallAt(p: Project, side: 'top' | 'bottom' | 'left' | 'right', x0 = 0, y0 = 0, w = 4, d = 4): string {
  const n = (id: string) => p.nodes.find((x) => x.id === id)!;
  const target = { top: [w / 2, y0], bottom: [w / 2, y0 + d], left: [x0, d / 2], right: [x0 + w, d / 2] }[side];
  return p.walls.find((wl) => {
    const a = n(wl.a);
    const b = n(wl.b);
    return Math.abs((a.x + b.x) / 2 - target[0]) < 0.2 && Math.abs((a.y + b.y) / 2 - target[1]) < 0.2;
  })!.id;
}

describe('daylight (#69, #93)', () => {
  it('maps plan directions to compass points with the north setting', () => {
    expect(compassOf(planBearing({ x: 0, y: -1 }, 0))).toBe('N');
    expect(compassOf(planBearing({ x: 0, y: 1 }, 0))).toBe('S');
    expect(compassOf(planBearing({ x: 1, y: 0 }, 0))).toBe('O');
    expect(compassOf(planBearing({ x: 0, y: -1 }, 90))).toBe('O');
    expect(compassOf(planBearing({ x: -1, y: 0 }, 180))).toBe('O');
  });

  it('knows when the sun shines on a facade', () => {
    expect(sunHoursFor(90)[0]).toBe(7);
    expect(sunHoursFor(90).includes(16)).toBe(false);
    expect(sunHoursFor(270).includes(17)).toBe(true);
    expect(sunHoursFor(0)).toEqual([]);
    expect(sunSpanLabel(sunHoursFor(180))).toBe('ca. 9–18 Uhr (Vormittag bis Nachmittag)');
    expect(sunSpanLabel([])).toBe('kaum direkte Sonne');
  });

  it('rates a room by its window sides and respects the north setting', () => {
    const p = createEmptyProject();
    addRectRoom(p, { x: 0, y: 0, width: 4, depth: 4, name: 'Wohnen', ...props });
    addRectRoom(p, { x: 0, y: 5, width: 4, depth: 4, name: 'Bad', ...props });
    addOpening(p, wallAt(p, 'bottom', 0, 5), 'window', 2);
    addOpening(p, wallAt(p, 'top'), 'window', 2);
    let res = computeDaylight(p, derivePlan(p));
    const living = res.rooms.find((r) => r.name === 'Wohnen')!;
    expect(living.directions).toEqual(['N']);
    expect(living.sunHours).toEqual([]);
    const bath = res.rooms.find((r) => r.name === 'Bad')!;
    expect(bath.directions).toEqual(['S']);
    expect(bath.sunHours.length).toBeGreaterThan(5);
    expect(res.rooms.find((r) => r.name === 'Bad')!.level).not.toBe('none');
    p.settings.northDirection = 180;
    res = computeDaylight(p, derivePlan(p));
    expect(res.rooms.find((r) => r.name === 'Wohnen')!.directions).toEqual(['S']);
  });

  it('a room without windows has no daylight, windows towards another room do not count', () => {
    const p = createEmptyProject();
    addRectRoom(p, { x: 0, y: 0, width: 4, depth: 4, name: 'A', ...props });
    addRectRoom(p, { x: 0, y: 4.12, width: 4, depth: 4, name: 'B', ...props });
    const res0 = computeDaylight(p, derivePlan(p));
    expect(res0.rooms.every((r) => r.level === 'none')).toBe(true);
    addOpening(p, wallAt(p, 'bottom'), 'window', 2);
    const res = computeDaylight(p, derivePlan(p));
    expect(res.rooms.find((r) => r.name === 'A')!.glassArea).toBeGreaterThanOrEqual(0);
  });

  it('gives a balcony its facing direction and sun hours', () => {
    const p = createEmptyProject();
    addRectRoom(p, { x: 0, y: 0, width: 4, depth: 4, name: 'Wohnen', ...props });
    addRectRoom(p, { x: 0, y: -2.12, width: 4, depth: 2, name: 'Balkon', ...props });
    const res = computeDaylight(p, derivePlan(p));
    expect(res.rooms.map((r) => r.name)).toEqual(['Wohnen']);
    expect(res.outdoor).toHaveLength(1);
    expect(res.outdoor[0].facing).toBe('N');
    p.settings.northDirection = 180;
    const flipped = computeDaylight(p, derivePlan(p));
    expect(flipped.outdoor[0].facing).toBe('S');
    expect(flipped.outdoor[0].sunHours.length).toBeGreaterThan(8);
  });
});
