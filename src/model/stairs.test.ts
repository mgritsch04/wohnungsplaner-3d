import { describe, expect, it } from 'vitest';
import { createFurnitureFromCatalog } from '../catalog/instantiate';
import { findCatalogItem } from '../catalog/generic';
import { addLevel, switchLevel } from './levels';
import { createSampleProject } from './sample';
import type { Furniture, Project } from './schema';
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
