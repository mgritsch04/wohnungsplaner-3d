import { createEmptyProject } from './factory';
import { addOpening, addRectRoom, closestWall } from './operations';
import type { Project } from './schema';
import { createFurnitureFromCatalog } from '../catalog/instantiate';
import { findCatalogItem } from '../catalog/generic';

/**
 * Demo apartment shown on first launch: living room + bedroom with a door
 * between them, an entrance door, windows and a few furniture pieces.
 */
export function createSampleProject(): Project {
  const p = createEmptyProject('Beispielwohnung');
  p.name = 'Beispielwohnung';
  const t = 0.12;
  const h = 2.6;
  const living = addRectRoom(p, { x: 0, y: 0, width: 5, depth: 4, name: 'Wohnzimmer', thickness: t, height: h, floorMaterialId: 'mat_floor_oak' });
  addRectRoom(p, { x: 5 + t, y: 0, width: 3.5, depth: 4, name: 'Schlafzimmer', thickness: t, height: h, floorMaterialId: 'mat_floor_walnut' });
  void living;

  const wallAt = (x: number, y: number) => closestWall(p, { x, y }, 0.2);
  const inner = wallAt(5.06, 2);
  if (inner) addOpening(p, inner.wall.id, 'door', inner.s, { swing: 'left' });
  const south = wallAt(1.2, 4.06);
  if (south) addOpening(p, south.wall.id, 'door', south.s, { width: 1.0 });
  const north1 = wallAt(2.5, -0.06);
  if (north1) addOpening(p, north1.wall.id, 'window', north1.s, { width: 1.8 });
  const north2 = wallAt(6.9, -0.06);
  if (north2) addOpening(p, north2.wall.id, 'window', north2.s);
  const east = wallAt(8.68, 2);
  if (east) addOpening(p, east.wall.id, 'window', east.s, { width: 1.0 });

  const place = (catalogId: string, x: number, y: number, rotation = 0) => {
    const item = findCatalogItem(catalogId);
    if (item) p.furniture.push(createFurnitureFromCatalog(item, { x, y, rotation }));
  };
  place('generic-sofa-3', 2.5, 3.45, Math.PI);
  place('generic-coffee-table', 2.5, 2.4);
  place('generic-tv-sideboard', 2.5, 0.25);
  place('generic-rug-200', 2.5, 2.3);
  place('generic-floor-lamp', 4.6, 3.6);
  place('generic-bed-160', 7.37, 1.16);
  place('generic-wardrobe-150', 6.1, 3.68, Math.PI);
  place('generic-nightstand', 6.3, 0.22);
  place('generic-nightstand', 8.41, 0.22);
  return p;
}
