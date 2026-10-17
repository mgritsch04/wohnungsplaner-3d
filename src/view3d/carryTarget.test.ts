import { describe, expect, it } from 'vitest';
import { createFurnitureFromCatalog } from '../catalog/instantiate';
import { findCatalogItem } from '../catalog/generic';
import { furnitureCorners } from '../editor2d/furnitureGeometry';
import { pointInPolygon } from '../model/vec';
import { CARRY_MIN, carryGoal } from './carryTarget';

const cat = (id: string) => findCatalogItem(id)!;
const look = (pitch: number) => ({ x: 0, y: Math.sin(pitch), z: Math.cos(pitch) });

describe('carry target in the walkthrough (#39, #219)', () => {
  // walker at (0, 0), eye 1.6 m, looking along +plan y at a table 1 m ahead
  const eye = { x: 0, y: 1.6, z: 0 };
  const table = createFurnitureFromCatalog(cat('generic-dining-table-4'), { x: 0, y: 1.2 });

  it('a small item goes onto the table top the gaze points at, even close up', () => {
    const box = createFurnitureFromCatalog(cat('generic-storage-box'), { x: 2, y: 0 });
    const pitch = -Math.atan((eye.y - table.height) / 1.0);
    const g = carryGoal(eye, look(pitch), [table, box], box.id);
    expect(g.y).toBeCloseTo(1.0, 2);
    expect(pointInPolygon(g, furnitureCorners(table))).toBe(true);
  });

  it('large furniture keeps following the floor point, at least 1.1 m ahead', () => {
    const sofa = createFurnitureFromCatalog(cat('generic-sofa-2'), { x: 2, y: 0 });
    const g = carryGoal(eye, look(-Math.atan((eye.y - table.height) / 1.0)), [table, sofa], sofa.id);
    expect(g.y).toBeGreaterThanOrEqual(CARRY_MIN);
    expect(g.y).toBeCloseTo((eye.y - 0.3) / (eye.y - table.height), 2);
  });

  it('looking past the table: the floor point as before', () => {
    const box = createFurnitureFromCatalog(cat('generic-storage-box'), { x: 2, y: 0 });
    const g = carryGoal(eye, look(-0.3), [table, box], box.id);
    expect(g.y).toBeCloseTo(Math.min(4, (eye.y - 0.3) / Math.tan(0.3)), 2);
  });
});
