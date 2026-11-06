import { describe, expect, it } from 'vitest';
import { findCatalogItem } from '../catalog/generic';
import { createFurnitureFromCatalog } from '../catalog/instantiate';
import { pairRule } from './placementRules';

const make = (id: string) => createFurnitureFromCatalog(findCatalogItem(id)!, { x: 0, y: 0 });

describe('pairRule', () => {
  it('lets a still life stand on a board of an open shelf, like a storage box (#436)', () => {
    expect(pairRule(make('generic-decor-set'), make('generic-shelf-80')).allowed).toBe(true);
    expect(pairRule(make('generic-shelf-80'), make('generic-decor-set')).allowed).toBe(true);
  });

  it('keeps other furniture out of a shelf', () => {
    expect(pairRule(make('generic-armchair'), make('generic-shelf-80')).allowed).toBe(false);
  });
});
