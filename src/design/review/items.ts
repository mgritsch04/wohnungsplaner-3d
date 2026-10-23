/**
 * Placed pieces as the walk-through sees them (#441): a `PlacedItem` plus what the catalogue
 * knows about it (role, shape, category), its footprint and front.
 */
import { findCatalogItem } from '../../catalog/generic';
import type { CatalogItem } from '../../catalog/types';
import { roleOf, shapeOf, type Role } from '../../suggest/roomGeometry';
import type { Vec2 } from '../../model/vec';
import { footprint, frontVec, rightVec } from './geom';
import type { PlacedItem } from '../types';

export interface RItem extends PlacedItem {
  /** Already in the flat before the proposal (fitted bath, existing kitchen). */
  existing: boolean;
  name: string;
  role: Role;
  shape: string;
  category: string;
  tags: string[];
  /** Kitchen module type (`sink`, `cooktop`, `fridge`, `base` …) for kitchen pieces. */
  kitchen?: string;
  poly: Vec2[];
  front: Vec2;
  right: Vec2;
  /** Stands on the floor (not hung, not lying on another piece, not a rug or curtain). */
  floor: boolean;
  /** Blocks walking: floor pieces except chairs, which are moved aside. */
  obstacle: boolean;
}

const FLAT_ROLES: ReadonlySet<Role> = new Set(['rug', 'curtain', 'mattress']);

export function toRItem(it: PlacedItem, existing: boolean, extra: CatalogItem[]): RItem {
  const cat = findCatalogItem(it.catalogId, extra);
  const name = (cat?.name ?? it.catalogId).replace(/ \(Platzhalter\)$/, '');
  const category = cat?.category ?? 'storage';
  const shape = cat ? shapeOf(cat) : 'cabinet';
  const role: Role = cat ? roleOf({ ...cat, elevation: it.elevation, height: it.height }) : 'wall';
  const floor = it.elevation < 0.05 && it.height >= 0.1 && !FLAT_ROLES.has(role) && category !== 'textile';
  return {
    ...it,
    existing,
    name,
    role,
    shape,
    category,
    tags: cat?.tags ?? [],
    kitchen: cat?.kitchen?.type ?? (shape.startsWith('k-') ? shape.slice(2) : undefined),
    poly: footprint({ x: it.x, y: it.y, rotation: it.rotation, width: it.width, depth: it.depth }),
    front: frontVec(it.rotation),
    right: rightVec(it.rotation),
    floor,
    obstacle: floor && role !== 'seat',
  };
}

export const isPlant = (i: RItem): boolean => i.shape === 'plant';
export const isLamp = (i: RItem): boolean => i.role === 'floor-lamp' || i.role === 'table-lamp' || i.role === 'pendant';
export const isDiningTable = (i: RItem): boolean => i.role === 'table' && i.category === 'table' && i.width >= 0.55 && i.height >= 0.6;
export const isSanitary = (i: RItem): boolean => i.category === 'bathroom';
export const isKitchenModule = (i: RItem): boolean => i.kitchen !== undefined;

/** Seats a sofa or armchair offers. */
export function seatsOf(i: RItem): number {
  if (i.shape === 'sofa-corner') return 5;
  if (i.role === 'sofa') return Math.max(1, Math.round(i.width / 0.65));
  if (i.role === 'armchair') return 1;
  return 0;
}
