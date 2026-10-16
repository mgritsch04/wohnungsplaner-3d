import type { DerivedPlan } from '../model/derived';
import type { Project } from '../model/schema';
import { closestPointOnSegment, dist, dot, pointInPolygon, sub, type Vec2 } from '../model/vec';
import type { Selection } from '../store/uiStore';
import { pointInFurniture } from './furnitureGeometry';

/**
 * Geometric hit testing in world coordinates. `tol` is the pick tolerance in meters
 * (usually a few screen pixels divided by the zoom).
 */
export function hitTest(p: Project, d: DerivedPlan, pt: Vec2, tol: number, opts: { nodes?: boolean } = {}): Selection | null {
  // Furniture is drawn on top of walls: a click clearly inside an item selects the item,
  // never a wall/corner underneath it (smallest item wins when stacked).
  const inside = p.furniture.filter((f) => pointInFurniture(f, pt, 0));
  if (inside.length) {
    inside.sort((a, b) => a.width * a.depth - b.width * b.depth);
    return { type: 'furniture', id: inside[0].id };
  }
  if (opts.nodes !== false) {
    let best: { id: string; dd: number } | null = null;
    for (const n of p.nodes) {
      const dd = dist(n, pt);
      if (dd <= tol * 1.5 && (!best || dd < best.dd)) best = { id: n.id, dd };
    }
    if (best) return { type: 'node', id: best.id };
  }
  // openings (on top of walls)
  for (const [wallId, list] of d.openings) {
    const fp = d.footprints.get(wallId);
    if (!fp) continue;
    const s = dot(sub(pt, fp.a), fp.dir);
    const off = Math.abs(dot(sub(pt, fp.a), fp.normal));
    for (const r of list) {
      if (s >= r.s0 - tol && s <= r.s1 + tol && off <= fp.thickness / 2 + tol) return { type: 'opening', id: r.opening.id };
    }
  }
  // furniture: topmost (last drawn) first, smaller items preferred when stacked
  const hits = p.furniture.filter((f) => pointInFurniture(f, pt, tol * 0.5));
  if (hits.length) {
    hits.sort((a, b) => a.width * a.depth - b.width * b.depth);
    return { type: 'furniture', id: hits[0].id };
  }
  for (const l of p.lights) {
    if (dist(l, pt) <= Math.max(0.15, tol * 2)) return { type: 'light', id: l.id };
  }
  for (const [wallId, fp] of d.footprints) {
    if (pointInPolygon(pt, fp.polygon) || closestPointOnSegment(pt, fp.a, fp.b).distance <= fp.thickness / 2 + tol) {
      return { type: 'wall', id: wallId };
    }
  }
  // rooms: smallest containing room first
  const rooms = [...d.rooms.values()].filter((g) => pointInPolygon(pt, g.interior)).sort((a, b) => a.area - b.area);
  if (rooms.length) return { type: 'room', id: rooms[0].roomId };
  return null;
}
