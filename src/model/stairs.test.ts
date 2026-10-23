import { describe, expect, it } from 'vitest';
import { createFurnitureFromCatalog } from '../catalog/instantiate';
import { findCatalogItem, GENERIC_CATALOG } from '../catalog/generic';
import { addLevel, switchLevel } from './levels';
import { createSampleProject } from './sample';
import type { Furniture, Project } from './schema';
import { layoutSurfaceAt, parseStairShape, stairLayout } from './stairLayout';
import { pointInPolygon, polygonCentroid } from './vec';
import { defaultStairHeight, holeInRoom, isStair, reachesAbove, stairSurfaceAt, stairwells, stepCount, walkGroundAt } from './stairs';

/** Sample flat with a storey above (2.6 m) and a 0.9 × 3.6 m stair in the living room, rising to −y. */
function house(): { p: Project; stair: Furniture; up: string } {
  const p = createSampleProject();
  const up = addLevel(p, { copyWalls: true });
  const stair = createFurnitureFromCatalog(findCatalogItem('generic-stairs')!, { x: 1, y: 2 });
  stair.height = defaultStairHeight(p);
  p.furniture.push(stair);
  return { p, stair, up };
}

describe('Treppen (#54)', () => {
  it('Katalog: gerade Treppe, nicht massiv, Höhe bis zur Etage darüber', () => {
    const { p, stair } = house();
    expect(isStair(stair)).toBe(true);
    expect(stair.solid).toBe(false);
    expect(stair.category).toBe('stairs');
    expect(stair.height).toBeCloseTo(2.6);
    expect(stepCount(2.6)).toBe(14);
    expect(reachesAbove(stair, 2.6)).toBe(true);
    expect(reachesAbove({ ...stair, height: 1 }, 2.6)).toBe(false);
    expect(isStair(p.furniture[0])).toBe(false);
  });

  it('Lauffläche steigt gleichmäßig von vorn (unten) nach hinten (oben)', () => {
    const { stair } = house();
    expect(stairSurfaceAt(stair, { x: 1, y: 3.8 })).toBeCloseTo(0, 5);
    expect(stairSurfaceAt(stair, { x: 1, y: 2 })).toBeCloseTo(1.3);
    expect(stairSurfaceAt(stair, { x: 1, y: 0.2 })).toBeCloseTo(2.6);
    expect(stairSurfaceAt(stair, { x: 2, y: 2 })).toBeNull();
    // rotated by 90°: rises towards +x
    const turned = { ...stair, rotation: Math.PI / 2 };
    expect(stairSurfaceAt(turned, { x: 2.8, y: 2 })).toBeCloseTo(2.6);
    expect(stairSurfaceAt(turned, { x: -0.8, y: 2 })).toBeCloseTo(0);
  });

  it('Boden beim Begehen: unten die Treppe, oben das Treppenloch, sonst 0', () => {
    const { p, up } = house();
    expect(walkGroundAt(p, { x: 1, y: 2 })).toBeCloseTo(1.3);
    expect(walkGroundAt(p, { x: 3, y: 2 })).toBe(0);
    switchLevel(p, up);
    expect(walkGroundAt(p, { x: 1, y: 2 })).toBeCloseTo(-1.3);
    expect(walkGroundAt(p, { x: 1, y: 0.2 })).toBeCloseTo(0);
    expect(walkGroundAt(p, { x: 3, y: 2 })).toBe(0);
  });

  it('Treppenloch: Decke unten und Boden oben bekommen den Umriss der Treppe', () => {
    const { p, up } = house();
    const down = p.activeLevelId;
    expect(stairwells(p).ceiling).toHaveLength(1);
    expect(stairwells(p).floor).toHaveLength(0);
    expect(stairwells(p, up).floor).toHaveLength(1);
    expect(stairwells(p, up).ceiling).toHaveLength(0);
    switchLevel(p, up);
    expect(stairwells(p).floor[0]).toHaveLength(4);
    expect(stairwells(p, down).ceiling).toHaveLength(1);
    // without a storey above a stair opens nothing
    const single = createSampleProject();
    single.furniture.push({ ...house().stair });
    expect(stairwells(single)).toEqual({ floor: [], ceiling: [] });
  });
});

describe('Treppenloch im Raum (#54)', () => {
  it('schneidet nur den Teil im Raum aus, knapp innerhalb des Raums', () => {
    const room = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 3 },
      { x: 0, y: 3 },
    ];
    // stair along the north wall: reaches 5 cm into the wall
    const well = [
      { x: 1, y: -0.05 },
      { x: 2, y: -0.05 },
      { x: 2, y: 2 },
      { x: 1, y: 2 },
    ];
    const hole = holeInRoom(room, well)!;
    expect(hole).not.toBeNull();
    expect(hole.every((p) => p.y > 0 && p.y < 2 && p.x > 1 && p.x < 2)).toBe(true);
    expect(holeInRoom(room, [...well].reverse())).not.toBeNull();
    expect(holeInRoom(room, well.map((p) => ({ x: p.x + 10, y: p.y })))).toBeNull();
  });
});

describe('gewendelte Treppen und Podeste (#335)', () => {
  const shapes = ['quarter-landing', 'quarter-winder', 'half-landing', 'half-winder', 'spiral'].flatMap((k) => [`stairs-${k}`, `stairs-${k}-r`]);

  it('Katalog: alle Formen vorhanden, nicht massiv, als Treppe erkannt', () => {
    for (const shape of shapes) {
      const item = GENERIC_CATALOG.find((c) => c.id === `generic-${shape}`);
      expect(item, shape).toBeDefined();
      const f = createFurnitureFromCatalog(item!, { x: 2, y: 2 });
      expect(isStair(f)).toBe(true);
      expect(f.solid).toBe(false);
    }
    expect(parseStairShape('stairs-r')).toBeNull();
    expect(parseStairShape('sofa')).toBeNull();
  });

  for (const shape of shapes) {
    it(`${shape}: durchgehend begehbar vom Fuß bis zur Oberkante, Stufen gleichmäßig`, () => {
      const item = GENERIC_CATALOG.find((c) => c.id === `generic-${shape}`)!;
      const layout = stairLayout(shape, item.width, item.depth, 2.6)!;
      const n = layout.treads.length;
      // tread tops climb in equal steps up to the storey height
      layout.treads.forEach((t, i) => expect(t.top).toBeCloseTo(((i + 1) * 2.6) / n, 6));
      expect(n).toBeGreaterThanOrEqual(5);
      // the walking line through the treads: always on the surface, never falling, never jumping by more than a step
      let prev = -Infinity;
      for (const t of layout.treads) {
        const c = polygonCentroid(t.poly);
        const z = layoutSurfaceAt(layout, c);
        expect(z, 'Tritt liegt auf der Lauffläche').not.toBeNull();
        expect(z!).toBeGreaterThanOrEqual(prev - 1e-6);
        expect(z! - Math.max(prev, 0)).toBeLessThanOrEqual((2.6 / n) * 2.2);
        expect(Math.abs(z! - t.top)).toBeLessThanOrEqual((2.6 / n) * 1.6);
        prev = z!;
      }
      expect(prev).toBeGreaterThan(2.6 - (2.6 / n) * 1.6);
      expect(prev).toBeLessThanOrEqual(2.6 + 1e-6);
      // every tread lies in the stairwell
      for (const t of layout.treads) {
        const c = polygonCentroid(t.poly);
        expect(layout.well.some((part) => pointInPolygon(c, part))).toBe(true);
      }
    });
  }

  it('Podest ist eben, Wendelstufen steigen mit dem Winkel, Spiegelung dreht die Laufrichtung', () => {
    const landing = stairLayout('stairs-half-landing', 1.8, 2.6, 2.6)!;
    const a = layoutSurfaceAt(landing, { x: -0.5, y: -1.1 })!;
    const b = layoutSurfaceAt(landing, { x: 0.6, y: -0.9 })!;
    expect(a).toBeCloseTo(b, 6);
    const winder = stairLayout('stairs-half-winder', 1.8, 2.4, 2.6)!;
    const around = [0.3, 0.9, 1.5, 2.1, 2.8].map((th) => layoutSurfaceAt(winder, { x: -Math.cos(th) * 0.4, y: -1.2 + 0.9 - Math.sin(th) * 0.4 })!);
    for (let i = 1; i < around.length; i++) expect(around[i]).toBeGreaterThan(around[i - 1]);
    const left = stairLayout('stairs-quarter-landing', 2.4, 2.8, 2.6)!;
    const right = stairLayout('stairs-quarter-landing-r', 2.4, 2.8, 2.6)!;
    expect(layoutSurfaceAt(left, { x: -1.0, y: 1.3 })).toBeCloseTo(layoutSurfaceAt(right, { x: 1.0, y: 1.3 })!, 6);
    expect(layoutSurfaceAt(left, { x: 1.0, y: 1.3 })).toBeNull();
  });

  it('Treppenloch folgt dem Umriss: L-Treppe zwei Teile, U und Wendeltreppe eins; Begehen steigt und wechselt die Etage', () => {
    const { p, up } = house();
    p.furniture = [];
    const item = GENERIC_CATALOG.find((c) => c.id === 'generic-stairs-quarter-landing')!;
    const s = createFurnitureFromCatalog(item, { x: 2, y: 2 });
    s.height = defaultStairHeight(p);
    p.furniture.push(s);
    expect(stairwells(p).ceiling).toHaveLength(2);
    // foot of the stair is at floor level, the end of the second flight reaches the storey above
    expect(walkGroundAt(p, { x: 2 - 1.2 + 0.4, y: 2 + 1.35 })).toBeLessThan(0.2);
    expect(walkGroundAt(p, { x: 2 + 1.15, y: 2 - 1.4 + 0.45 })).toBeGreaterThan(2.3);
    // empty inner corner is not a stair
    expect(walkGroundAt(p, { x: 2 + 0.5, y: 2 + 0.5 })).toBe(0);
    switchLevel(p, up);
    expect(stairwells(p).floor).toHaveLength(2);
    expect(walkGroundAt(p, { x: 2 + 1.15, y: 2 - 1.4 + 0.45 })).toBeGreaterThan(-0.3);
  });
});
