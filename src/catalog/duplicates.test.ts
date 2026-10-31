import { describe, expect, it } from 'vitest';
import { GENERIC_CATALOG } from './generic';
import { createFurnitureFromCatalog } from './instantiate';
import { applyMergeToCatalog, articleKey, findDuplicateGroups, previewMerge, rehomeFurniture } from './duplicates';
import type { CatalogItem } from './types';

const item = (id: string, over: Partial<CatalogItem> = {}): CatalogItem => ({
  id,
  name: 'KALLAX Regal',
  category: 'storage',
  width: 0.77,
  depth: 0.39,
  height: 1.47,
  color: '#fff',
  model: { type: 'procedural', shape: 'cabinet' },
  approximate: true,
  solid: true,
  tags: [],
  source: 'imported',
  sourceName: 'IKEA-Auswahl',
  ...over,
});

const none = { furniture: [] };

describe('duplicate detection', () => {
  it('groups by article number across spellings and different names', () => {
    const g = findDuplicateGroups([item('a', { tags: ['803.518.66'] }), item('b', { name: 'Regal weiß', width: 0.5, tags: ['80351866'] }), item('c', { name: 'Sofa', tags: ['111.111.11'] })], none);
    expect(g).toHaveLength(1);
    expect(g[0].reason).toBe('article');
    expect(g[0].members.map((m) => m.item.id).sort()).toEqual(['a', 'b']);
  });

  it('groups by product URL ignoring www, query and trailing slash', () => {
    const g = findDuplicateGroups(
      [item('a', { name: 'X1', productUrl: 'https://www.ikea.com/at/de/p/kallax-80351866/?x=1' }), item('b', { name: 'Y2', width: 1, productUrl: 'https://ikea.com/at/de/p/kallax-80351866' })],
      none,
    );
    expect(g).toHaveLength(1);
    expect(g[0].reason).toBe('article');
  });

  it('groups by name and size within 1 cm, width/depth swapped', () => {
    const g = findDuplicateGroups([item('a'), item('b', { width: 0.39, depth: 0.77 })], none);
    expect(g).toHaveLength(1);
    expect(g[0].reason).toBe('name');
  });

  it('does not group different sizes, generic items or single items', () => {
    expect(findDuplicateGroups([item('a'), item('b', { height: 1.2 }), ...GENERIC_CATALOG.slice(0, 3)], none)).toEqual([]);
  });

  it('keeps the most used entry by default, then the one with 3D model', () => {
    const a = item('a');
    const b = item('b', { model: { type: 'gltf', assetId: 'x', fallbackShape: 'cabinet' } });
    expect(findDuplicateGroups([a, b], none)[0].keepId).toBe('b');
    const placed = createFurnitureFromCatalog(a, { x: 1, y: 1 });
    expect(findDuplicateGroups([a, b], { furniture: [placed] })[0].keepId).toBe('a');
  });
});

describe('merging', () => {
  it('re-points placements, fills gaps and drops the others', () => {
    const a = item('a');
    const b = item('b', { price: { amount: 99, currency: 'EUR', status: 'user' }, imageUrl: 'https://x.test/i.jpg' });
    const furniture = [createFurnitureFromCatalog(b, { x: 1, y: 1 }), createFurnitureFromCatalog(a, { x: 2, y: 2 })];
    const [group] = findDuplicateGroups([a, b], { furniture });
    const pv = previewMerge(group, 'a', { furniture });
    expect(pv.rehomed).toBe(1);
    expect(pv.filled).toEqual(['Preis', 'Foto']);
    expect(rehomeFurniture(furniture, new Set(['b']), 'a')).toBe(1);
    expect(furniture.every((f) => f.catalogId === 'a')).toBe(true);
    const next = applyMergeToCatalog([a, b], 'a', new Set(['b']));
    expect(next.map((i) => i.id)).toEqual(['a']);
    expect(next[0].price?.amount).toBe(99);
  });

  it('articleKey reads tags and IKEA URLs', () => {
    expect(articleKey(item('a', { tags: ['s79351866'] }))).toBe('79351866');
    expect(articleKey(item('a', { productUrl: 'https://www.ikea.com/at/de/p/billy-regal-10263838/' }))).toBe('10263838');
  });
});
