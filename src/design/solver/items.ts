/**
 * What the solver needs to know about a catalogue piece: where it goes (floor, wall, ceiling,
 * on top of something), whether it blocks the way, and the movement area it needs in front
 * and beside it (Neufert, see docs/EINRICHTUNG_NEU.md › Stufe 4 B6).
 */
import { findCatalogItem } from '../../catalog/generic';
import type { CatalogItem } from '../../catalog/types';
import { roleOf, shapeOf, type Role } from '../../suggest/roomGeometry';

/**
 * floor: stands on the floor and blocks the way (plants and floor lamps too);
 * rug: lies on the floor, others may stand on it; wall: hangs on a wall (picture, mirror, coat
 * hooks, TV, wall shelf); ceiling: pendant; curtain: hangs at a window; stack: small piece
 * that goes on a surface (table lamp, small plant, box, mattress).
 */
export type Base = 'floor' | 'rug' | 'wall' | 'ceiling' | 'curtain' | 'stack';

/** A movement area: strip on one side of the piece that must stay free of other furniture. */
export interface Clearance {
  side: 'front' | 'left' | 'right' | 'back';
  /** Required depth (hard) and comfortable depth (soft, the solver aims for it). */
  min: number;
  comfort: number;
  /** Part of the side it covers, as fractions from the back (left/right) or from the left (front/back). */
  from?: number;
  to?: number;
  /** Only one of the strips marked `either` is required (single bed: one long side). */
  either?: boolean;
}

export type WallBound = 'always' | 'prefer' | 'free';

export interface Spec {
  catalogId: string;
  name: string;
  category: string;
  shape: string;
  role: Role;
  width: number;
  depth: number;
  height: number;
  /** Default height of the base above the floor. */
  elevation: number;
  base: Base;
  /** Back against a wall: always (bed, wardrobe), preferred (sofa, desk) or free (table, armchair). */
  wall: WallBound;
  clear: Clearance[];
  /** Sides from which it must be reachable (empty: no check, e.g. plants and lamps). */
  access: ('front' | 'left' | 'right' | 'back')[];
  /** Offers a top for stack pieces. */
  surface: boolean;
  item: CatalogItem;
}

const KITCHEN_FLOOR = new Set(['base', 'tall', 'sink', 'oven', 'fridge', 'dishwasher']);

function clearancesOf(shape: string, role: Role, it: CatalogItem): Clearance[] {
  if (it.kitchen) return KITCHEN_FLOOR.has(it.kitchen.type) ? [{ side: 'front', min: 1.0, comfort: 1.2 }] : [];
  if (role === 'bed') {
    const single = it.width < 1.2;
    const side = (s: 'left' | 'right'): Clearance => ({ side: s, min: 0.5, comfort: 0.7, from: 0.22, to: 1, ...(single ? { either: true } : {}) });
    return [side('left'), side('right')];
  }
  if (shape === 'wardrobe') return [{ side: 'front', min: 0.7, comfort: 0.9 }];
  if (shape === 'shelf') return [{ side: 'front', min: 0.5, comfort: 0.7 }];
  if (shape === 'dresser' || (it.category === 'storage' && shape === 'cabinet' && it.height > 0.3)) return [{ side: 'front', min: 0.5, comfort: 0.7 }];
  if (it.category === 'desk') return [{ side: 'front', min: 0.75, comfort: 1.0 }];
  if (shape === 'washer') return [{ side: 'front', min: 0.6, comfort: 0.8 }];
  if (shape === 'toilet' || shape === 'washbasin') return [{ side: 'front', min: 0.55, comfort: 0.7 }];
  if (shape === 'bathtub' || shape === 'shower') return [{ side: 'front', min: 0.55, comfort: 0.7 }];
  if (role === 'sofa') return [{ side: 'front', min: 0.4, comfort: 0.6 }];
  if (role === 'armchair') return [{ side: 'front', min: 0.35, comfort: 0.5 }];
  if (role === 'seat' && shape !== 'stool') return [{ side: 'back', min: 0.25, comfort: 0.4 }];
  return [];
}

function baseOf(role: Role, shape: string, it: CatalogItem): Base {
  if (role === 'rug') return 'rug';
  if (role === 'curtain') return 'curtain';
  if (role === 'pendant') return 'ceiling';
  if (role === 'table-lamp' || role === 'box' || role === 'mattress') return 'stack';
  if (shape === 'plant' && it.height <= 0.6) return 'stack';
  if (role === 'wall-art' || role === 'mirror' || role === 'coat-rack' || role === 'tv') return 'wall';
  // thin, non-solid panels (standing mirror) hang on the wall
  if (!it.solid && it.depth <= 0.1 && !it.kitchen) return 'wall';
  if (it.kitchen && ['wall', 'hood', 'cooktop', 'countertop'].includes(it.kitchen.type)) return 'wall';
  return 'floor';
}

function wallOf(role: Role, shape: string, it: CatalogItem): WallBound {
  if (it.kitchen || ['bed', 'tv-board', 'nightstand', 'corner'].includes(role)) return shape === 'plant' ? 'prefer' : 'always';
  if (['wardrobe', 'shelf', 'dresser', 'cabinet', 'washer', 'toilet', 'washbasin', 'bathtub', 'shower', 'vacuum'].includes(shape)) return 'always';
  if (role === 'sofa' || it.category === 'desk' || role === 'floor-lamp') return 'prefer';
  if (role === 'wall') return 'always';
  return 'free';
}

function accessOf(role: Role, base: Base, shape: string, it: CatalogItem): Spec['access'] {
  if (base !== 'floor' || shape === 'plant' || role === 'floor-lamp' || shape === 'vacuum') return [];
  if (role === 'bed') return ['left', 'right', 'front'];
  if (role === 'table' || role === 'coffee-table') return ['front', 'back', 'left', 'right'];
  if (role === 'seat' || role === 'nightstand' || role === 'side-table') return [];
  if (it.category === 'chair') return [];
  return ['front'];
}

const cache = new Map<string, Spec>();

/** Spec of a catalogue id (generic or one of `extra`); undefined for an unknown id. */
export function specOf(catalogId: string, extra: CatalogItem[] = []): Spec | undefined {
  const key = extra.length ? '' : catalogId;
  if (key && cache.has(key)) return cache.get(key);
  const it = findCatalogItem(catalogId, extra);
  if (!it) return undefined;
  const shape = shapeOf(it);
  const role = roleOf({ ...it, catalogId: it.id });
  const base = baseOf(role, shape, it);
  const spec: Spec = {
    catalogId: it.id,
    name: it.name,
    category: it.category,
    shape,
    role,
    width: it.width,
    depth: it.depth,
    height: it.height,
    elevation: it.elevation ?? 0,
    base,
    wall: wallOf(role, shape, it),
    clear: base === 'floor' ? clearancesOf(shape, role, it) : [],
    access: accessOf(role, base, shape, it),
    surface: base === 'floor' && !['bed', 'sofa', 'armchair', 'seat', 'floor-lamp'].includes(role) && shape !== 'plant' && it.height >= 0.3 && it.height <= 1.3,
    item: it,
  };
  if (key) cache.set(key, spec);
  return spec;
}

/**
 * Smaller pieces of the same kind, tried in order when a piece does not fit (bed 160 → 140,
 * sofa 3 → 2, desk 140 → 100). The programme's own fallbacks come first.
 */
const SMALLER: Record<string, string[]> = {
  'generic-bed-180': ['generic-bed-160', 'generic-bed-140'],
  'generic-bed-160': ['generic-bed-140'],
  'generic-bed-140': ['generic-bed-90'],
  'generic-sofa-corner': ['generic-sofa-3', 'generic-sofa-2'],
  'generic-sofa-3': ['generic-sofa-2'],
  'generic-dining-table-6': ['generic-dining-table-4'],
  'generic-dining-table-4': ['generic-round-table'],
  'generic-wardrobe-200': ['generic-wardrobe-150', 'generic-wardrobe-100'],
  'generic-wardrobe-150': ['generic-wardrobe-100'],
  'generic-desk': ['generic-desk-small'],
  'generic-shelf-cube': ['generic-shelf-80'],
  'generic-sideboard': ['generic-dresser'],
  'generic-tv-sideboard': ['generic-sideboard', 'generic-dresser'],
  'generic-rug-200': ['generic-rug-160'],
  'generic-rug-160': ['generic-outdoor-rug'],
  'generic-utility-shelf': ['generic-shelf-80'],
  'generic-plant': ['generic-plant-small'],
  'generic-picture-wide': ['generic-picture-large'],
  'generic-picture-large': ['generic-picture'],
  'generic-coffee-table': ['generic-balcony-table'],
  'generic-washbasin': ['generic-washbasin-40'],
};

export function smallerOptions(catalogId: string, own: string[] = []): string[] {
  const out: string[] = [];
  const queue = [...own, ...(SMALLER[catalogId] ?? [])];
  // follow the chain: bed 180 → 160 → 140 → 90
  for (let k = 0; k < queue.length && out.length < 6; k++) {
    const id = queue[k];
    if (id === catalogId || out.includes(id)) continue;
    out.push(id);
    queue.push(...(SMALLER[id] ?? []));
  }
  return out;
}
