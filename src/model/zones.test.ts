import { describe, expect, it } from 'vitest';
import { createEmptyProject } from './factory';
import { addOpening, addRectRoom, closestWall } from './operations';
import { derivePlan } from './derived';
import { ProjectSchema } from './schema';
import { describeZone, isKeepFree, polygonInside, polygonsOverlap, rectPoints, zoneAt, zoneLabels, zoneRoomId } from './zones';

const T = 0.12;

function project() {
  const p = createEmptyProject();
  addRectRoom(p, { x: 0, y: 0, width: 4, depth: 3, name: 'Wohnzimmer', thickness: T, height: 2.6 });
  const north = closestWall(p, { x: 0.8, y: -T / 2 }, 0.2);
  if (north) addOpening(p, north.wall.id, 'window', north.s);
  return p;
}

describe('marked areas (#416)', () => {
  it('rectangle, labels, hit test and room', () => {
    const p = project();
    p.zones.push({ id: 'z1', purpose: 'Arbeitsecke', points: rectPoints({ x: 1.6, y: 1.2 }, { x: 0, y: 0 }) }, { id: 'z2', purpose: 'frei lassen', points: rectPoints({ x: 2.5, y: 1.5 }, { x: 3.5, y: 2.5 }) });
    expect(p.zones[0].points[0]).toEqual({ x: 0, y: 0 });
    expect([...zoneLabels(p.zones).values()]).toEqual(['Z1', 'Z2']);
    expect(zoneAt(p.zones, { x: 0.5, y: 0.5 })?.id).toBe('z1');
    expect(zoneAt(p.zones, { x: 2, y: 2.8 })).toBeNull();
    const d = derivePlan(p);
    expect(zoneRoomId(p, d, p.zones[0])).toBe(p.rooms[0].id);
    expect(isKeepFree(p.zones[1].purpose)).toBe(true);
    expect(isKeepFree('Arbeitsecke')).toBe(false);
  });

  it('describes size, position, walls and the window for Claude', () => {
    const p = project();
    const z = { id: 'z1', purpose: 'Arbeitsecke', points: rectPoints({ x: 0, y: 0 }, { x: 1.6, y: 1.2 }) };
    const text = describeZone(derivePlan(p), z, p.rooms[0].id);
    expect(text).toContain('1,6 × 1,2 m');
    expect(text).toContain('in einer Ecke');
    expect(text).toContain('Fenster');
    const free = describeZone(derivePlan(p), { ...z, points: rectPoints({ x: 1.5, y: 1 }, { x: 2.5, y: 2 }) }, p.rooms[0].id);
    expect(free).toContain('frei im Raum');
  });

  it('overlap and containment also for non-convex shapes', () => {
    const l = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 2 },
      { x: 0, y: 2 },
    ];
    expect(polygonsOverlap(l, rectPoints({ x: 1.2, y: 1.2 }, { x: 1.8, y: 1.8 }))).toBe(false);
    expect(polygonsOverlap(l, rectPoints({ x: 0.2, y: 0.2 }, { x: 0.6, y: 0.6 }))).toBe(true);
    expect(polygonsOverlap(rectPoints({ x: 0, y: 0 }, { x: 1, y: 1 }), rectPoints({ x: 1, y: 0 }, { x: 2, y: 1 }))).toBe(false);
    expect(polygonInside(rectPoints({ x: 0.1, y: 0.1 }, { x: 0.9, y: 1.9 }), l)).toBe(true);
    expect(polygonInside(rectPoints({ x: 0.5, y: 0.5 }, { x: 1.5, y: 1.5 }), l)).toBe(false);
  });

  it('is stored in the project; older projects without zones still load', () => {
    const p = project();
    p.zones.push({ id: 'z1', purpose: 'Essbereich', points: rectPoints({ x: 0, y: 0 }, { x: 1, y: 1 }) });
    expect(ProjectSchema.parse(JSON.parse(JSON.stringify(p))).zones[0].purpose).toBe('Essbereich');
    const { zones: _zones, ...old } = p;
    expect(ProjectSchema.parse(JSON.parse(JSON.stringify(old))).zones).toEqual([]);
  });
});
