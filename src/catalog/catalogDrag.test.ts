import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '../model/factory';
import { addRectRoom } from '../model/operations';
import { derivePlan } from '../model/derived';
import { buildPlacementObstacles } from '../model/placement';
import { catalogDropPreview, draggedCatalogItem, endCatalogDrag, startCatalogDrag } from './catalogDrag';
import { createFurnitureFromCatalog } from './instantiate';
import type { CatalogItem } from './types';

function roomProject() {
  const p = createEmptyProject();
  // clear interior 0..4 × 0..3
  addRectRoom(p, { x: 0, y: 0, width: 4, depth: 3, name: 'A', thickness: 0.12, height: 2.6 });
  return p;
}
const ITEM = { id: 'test-box', name: 'Kiste', category: 'storage', width: 0.8, depth: 0.4, height: 0.6, color: '#888888', model: { type: 'procedural', shape: 'box' } } as unknown as CatalogItem;

describe('catalog drop preview (#217)', () => {
  it('shows the item as it would be placed, without changing the project', () => {
    const p = roomProject();
    const d = derivePlan(p);
    const before = JSON.stringify(p);
    const g = catalogDropPreview(p, d, buildPlacementObstacles(d), ITEM, { x: 2.013, y: 1.52 });
    expect(g.level).toBe('ok');
    expect(g.item).toMatchObject({ name: 'Kiste', width: 0.8, depth: 0.4 });
    // the same 5 cm grid as on drop
    expect(g.item.x).toBeCloseTo(2, 3);
    expect(g.item.y).toBeCloseTo(1.5, 3);
    expect(JSON.stringify(p)).toBe(before);
  });

  it('marks an occupied spot as a conflict and a spot outside every room as outside', () => {
    const p = roomProject();
    p.furniture.push(createFurnitureFromCatalog(ITEM, { x: 2, y: 1.5 }));
    const d = derivePlan(p);
    const o = buildPlacementObstacles(d);
    expect(catalogDropPreview(p, d, o, ITEM, { x: 2, y: 1.5 }).level).toMatch(/error|warn/);
    expect(catalogDropPreview(p, d, o, ITEM, { x: 6, y: 1.5 }).level).toBe('outside');
    expect(p.furniture).toHaveLength(1);
  });

  it('keeps the dragged entry until the drag ends and replaces the native drag image', () => {
    let image: Element | null = null;
    const dt = { setData: () => {}, setDragImage: (el: Element) => (image = el), effectAllowed: 'all' } as unknown as DataTransfer;
    startCatalogDrag(dt, ITEM);
    expect(draggedCatalogItem()).toBe(ITEM);
    expect(image).not.toBeNull();
    endCatalogDrag();
    expect(draggedCatalogItem()).toBeNull();
  });
});
