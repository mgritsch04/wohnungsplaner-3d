/**
 * Small helpers shared by the flat concept (stage 1) and the room programme (stage 2).
 */
import type { CatalogItem } from '../../catalog/types';
import type { Furniture } from '../../model/schema';

/**
 * A parsed answer with what the app found. `problems` are errors Claude is asked to repair (once,
 * in a second request); `notes` are what the app fixed or dropped by itself (shown for debugging).
 */
export interface Checked<T> {
  value: T;
  problems: string[];
  notes: string[];
}

/** What a piece is, for the checks: catalogue category and model shape. */
export interface Thing {
  category: string;
  shape: string;
  height: number;
  width: number;
  depth: number;
  name: string;
}

type Modelled = Pick<CatalogItem, 'model'> | Pick<Furniture, 'model'>;

export const shapeOf = (c: Modelled): string => (c.model.type === 'procedural' ? c.model.shape : c.model.fallbackShape);

export const thingOf = (c: Pick<CatalogItem, 'category' | 'height' | 'width' | 'depth' | 'name' | 'model'>): Thing => ({
  category: c.category,
  shape: shapeOf(c),
  height: c.height,
  width: c.width,
  depth: c.depth,
  name: c.name,
});

export const str = (v: unknown, max = 600): string => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : typeof v === 'number' ? String(v) : '');

export const strList = (v: unknown, max = 300, limit = 30): string[] =>
  (Array.isArray(v) ? v : typeof v === 'string' && v.trim() ? [v] : [])
    .map((x) => str(x, max))
    .filter(Boolean)
    .slice(0, limit);

export const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

export const HEX = /^#[0-9a-f]{6}$/i;

/** A colour as #rrggbb (lower case), also from #rgb; null otherwise. */
export function hex(v: unknown): string | null {
  const s = str(v, 20);
  if (HEX.test(s)) return s.toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s);
  return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase() : null;
}

/** Comparable form of a name („Zimmer 1 “ → „zimmer 1“). */
export const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Fixed sanitary objects: never planned new (A3), the existing ones are not listed again. */
export const SANITARY = new Set(['toilet', 'washbasin', 'shower', 'bathtub']);

/** Modules of a kitchen run (the app builds wall cabinets, worktop, cooktop and hood around them). */
export const isKitchenModule = (c: Pick<CatalogItem, 'kitchen'>) => !!c.kitchen;
