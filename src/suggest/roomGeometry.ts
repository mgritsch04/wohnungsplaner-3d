/**
 * Shared room geometry for placing and judging furniture (#137, #350): the role a piece plays
 * (bed, sofa, wall item …), its front and side directions, and the walls of a room with their
 * doors and windows.
 */
import { findCatalogItem } from '../catalog/generic';
import type { CatalogItem } from '../catalog/types';
import type { DerivedPlan } from '../model/derived';
import type { Furniture } from '../model/schema';
import { add, dist, dot, normalize, perp, pointInPolygon, scale, sub, type Vec2 } from '../model/vec';

export type Role =
  | 'bed'
  | 'sofa'
  | 'tv-board'
  | 'table'
  | 'wall'
  | 'corner'
  | 'nightstand'
  | 'coffee-table'
  | 'side-table'
  | 'armchair'
  | 'seat'
  | 'floor-lamp'
  | 'rug'
  | 'tv'
  | 'table-lamp'
  | 'pendant'
  | 'mattress'
  | 'box'
  | 'curtain'
  | 'mirror'
  | 'coat-rack'
  | 'wall-art';

export const shapeOf = (f: Pick<Furniture, 'model'>) => (f.model.type === 'procedural' ? f.model.shape : f.model.fallbackShape);
export const CORNER_SHAPES = new Set(['wardrobe', 'shelf', 'shower', 'bathtub', 'washer', 'plant', 'k-fridge', 'vacuum']);

export type RoleInput = Pick<CatalogItem, 'name' | 'category' | 'model'> & { tags?: string[]; catalogId?: string; elevation?: number; height?: number };

export function roleOf(f: RoleInput): Role {
  // placed items carry no tags: take them from their generic catalogue entry
  const item: RoleInput = (f.catalogId && findCatalogItem(f.catalogId)) || f;
  const shape = shapeOf(item);
  const tags = item.tags ?? [];
  if (shape === 'mattress') return 'mattress';
  if (item.category === 'bed') return shape === 'bed' ? 'bed' : 'nightstand';
  if (item.category === 'chair') return 'seat';
  if (shape === 'rug') return 'rug';
  if (shape === 'curtain') return 'curtain';
  if (shape === 'picture' || shape === 'wall-shelf') return 'wall-art';
  if (shape === 'coat-rack') return 'coat-rack';
  // a small mirror hangs (bath: above the washbasin); a tall one stands on the floor against a wall
  if (shape === 'panel' && (item.elevation ?? 0) >= 0.8) return 'mirror';
  if (shape === 'box' && item.category === 'storage' && (item.height ?? 1) <= 0.45) return 'box';
  if (shape === 'tv') return 'tv';
  if (shape === 'pendant') return 'pendant';
  if (shape === 'table-lamp') return 'table-lamp';
  if (shape === 'floor-lamp') return 'floor-lamp';
  if (item.category === 'table') return tags.includes('beistelltisch') || /beistelltisch/i.test(item.name) ? 'side-table' : tags.includes('couchtisch') || /couchtisch/i.test(item.name) ? 'coffee-table' : 'table';
  if (item.category === 'storage' && (tags.includes('tv') || /tv|lowboard/i.test(item.name))) return 'tv-board';
  if (shape === 'armchair') return 'armchair';
  if (shape === 'sofa' || shape === 'sofa-corner') return 'sofa';
  if (CORNER_SHAPES.has(shape)) return 'corner';
  return 'wall';
}

/** Rotation whose local front (+y, see `frontClearance`) points along `fwd`. */
export const rotationFacing = (fwd: Vec2) => Math.atan2(-fwd.x, fwd.y);
export const frontOf = (f: Pick<Furniture, 'rotation'>): Vec2 => ({ x: -Math.sin(f.rotation), y: Math.cos(f.rotation) });
export const rightOf = (f: Pick<Furniture, 'rotation'>): Vec2 => ({ x: Math.cos(f.rotation), y: Math.sin(f.rotation) });

export interface Span {
  t0: number;
  t1: number;
  window: boolean;
  /** Window: underside and top above the floor. */
  bottom: number;
  top: number;
}

export interface Edge {
  a: Vec2;
  dir: Vec2;
  inward: Vec2;
  length: number;
  /** Doors and windows in this wall stretch (positions along the edge). */
  openings: Span[];
}

export function roomEdges(poly: Vec2[], d?: DerivedPlan): Edge[] {
  const out: Edge[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const length = dist(a, b);
    if (length < 0.3) continue;
    const dir = normalize(sub(b, a));
    let inward = perp(dir);
    const mid = add(scale(add(a, b), 0.5), scale(inward, 0.02));
    if (!pointInPolygon(mid, poly)) inward = scale(inward, -1);
    const openings: Span[] = [];
    if (d) {
      for (const [wallId, list] of d.openings) {
        const fp = d.footprints.get(wallId);
        if (!fp) continue;
        for (const r of list) {
          const pa = add(fp.a, scale(fp.dir, r.s0));
          const pb = add(fp.a, scale(fp.dir, r.s1));
          // the opening lies in this edge's wall: its centre line is about half a wall thickness behind the edge
          const off = (p: Vec2) => Math.abs(dot(sub(p, a), inward));
          if (off(pa) > fp.thickness / 2 + 0.06 || off(pb) > fp.thickness / 2 + 0.06) continue;
          const ta = dot(sub(pa, a), dir);
          const tb = dot(sub(pb, a), dir);
          const t0 = Math.min(ta, tb);
          const t1 = Math.max(ta, tb);
          if (t1 < 0 || t0 > length) continue;
          openings.push({ t0: Math.max(0, t0), t1: Math.min(length, t1), window: r.opening.kind === 'window', bottom: r.bottom, top: r.top });
        }
      }
    }
    out.push({ a, dir, inward, length, openings });
  }
  return out;
}

export const hasWindow = (e: Edge) => e.openings.some((o) => o.window);
export const hasDoor = (e: Edge) => e.openings.some((o) => !o.window);

export const longestFirst = (edges: Edge[]) => [...edges].sort((a, b) => b.length - a.length);
/** Walls without windows (and doors) first, each group longest first: beds, sofas and wardrobes need a closed wall. */
export const closedFirst = (edges: Edge[]) => [...edges].sort((a, b) => Number(hasWindow(a)) + 0.5 * Number(hasDoor(a)) - (Number(hasWindow(b)) + 0.5 * Number(hasDoor(b))) || b.length - a.length);
