import { describe, expect, it } from 'vitest';
import { GENERIC_CATALOG } from './generic';
import { createFurnitureFromCatalog, defaultElevation } from './instantiate';
import { foundToCatalog } from '../assistant/productSearch';
import { buildParts } from '../view3d/ProceduralModel';
import type { CatalogItem } from './types';

const generic = (id: string) => GENERIC_CATALOG.find((c) => c.id === id) as CatalogItem;

describe('mounting height', () => {
  it('a low washbasin (found product, bowl only) hangs with its rim at 85 cm', () => {
    const f = foundToCatalog(
      { name: 'Aufsatzwaschbecken', url: 'https://example.test/p/1', width: 0.6, depth: 0.45, height: 0.15, price: 99, packSize: 1, shop: 'IKEA' } as never,
      generic('generic-washbasin'),
    );
    const placed = createFurnitureFromCatalog(f, { x: 1, y: 1 });
    expect(placed.elevation + placed.height).toBeCloseTo(0.85, 3);
  });

  it('the generic vanity unit stands on the floor and an explicit elevation wins', () => {
    expect(createFurnitureFromCatalog(generic('generic-washbasin'), { x: 0, y: 0 }).elevation).toBe(0);
    expect(defaultElevation({ ...generic('generic-washbasin'), height: 0.2, elevation: 0.5 })).toBe(0.5);
  });

  it('a low basin model starts at its own origin, not at 35 cm', () => {
    const parts = buildParts('washbasin', 0.6, 0.45, 0.15, '#ffffff');
    for (const p of parts) expect(p.s.every((v) => v >= 0)).toBe(true);
  });

  it('wall-mounted generic items hang above the floor', () => {
    for (const shape of ['panel', 'picture', 'wall-shelf', 'coat-rack', 'k-wall', 'k-hood']) {
      for (const c of GENERIC_CATALOG.filter((i) => i.model.type === 'procedural' && i.model.shape === shape)) {
        if (c.id === 'generic-mirror') continue; // tall mirror leans on the floor
        expect(c.elevation ?? 0, c.id).toBeGreaterThan(0);
      }
    }
  });
});
