import { BODY_HEIGHT_DEFAULT, eyeFromBody } from '../model/body';
import type { DerivedPlan } from '../model/derived';
import type { Furniture } from '../model/schema';
import { furnitureCorners } from '../editor2d/furnitureGeometry';
import { clipFootprint } from '../model/geometry/walls';
import { closestPointOnSegment, pointInPolygon, sub, type Vec2 } from '../model/vec';

/** Heights relevant for walking: obstacles between STEP and HEAD block the player. */
export const STEP_HEIGHT = 0.25;
export const HEAD_HEIGHT = 1.85;
/** Default eye height in the walkthrough (follows the body height per project: settings.bodyHeight, #263). */
export const EYE_HEIGHT = eyeFromBody(BODY_HEIGHT_DEFAULT);
export const PLAYER_RADIUS = 0.22;

export type Collider = Vec2[];

/**
 * Convex obstacle polygons from wall pieces (respecting door openings), closed
 * doors (#21: a closed leaf shuts its opening like the wall) and solid furniture.
 */
export function buildColliders(derived: DerivedPlan, furniture: Furniture[]): Collider[] {
  const out: Collider[] = [];
  for (const pieces of derived.pieces.values()) {
    for (const pc of pieces) {
      if (pc.z0 < HEAD_HEIGHT && pc.z1 > STEP_HEIGHT) out.push(pc.polygon);
    }
  }
  for (const h of derived.hubs) out.push(h.polygon);
  for (const [wallId, list] of derived.openings) {
    const fp = derived.footprints.get(wallId);
    if (!fp) continue;
    for (const r of list) {
      const leaves = derived.leaves.get(r.opening.id) ?? [];
      if (r.opening.open || !leaves.some((l) => l.z0 < HEAD_HEIGHT && l.z1 > STEP_HEIGHT)) continue;
      const gap = clipFootprint(fp, r.s0, r.s1);
      if (gap.length >= 3) out.push(gap);
    }
  }
  for (const f of furniture) {
    if (!f.solid) continue;
    if (f.elevation >= HEAD_HEIGHT || f.elevation + f.height <= STEP_HEIGHT) continue;
    out.push(furnitureCorners(f));
  }
  return out;
}

/**
 * Resolve a circle against convex polygons by pushing it out along the
 * shortest separation. Several iterations give natural sliding along walls.
 */
export function resolveCollisions(p: Vec2, colliders: Collider[], radius = PLAYER_RADIUS, iterations = 4): Vec2 {
  let pos = { ...p };
  for (let it = 0; it < iterations; it++) {
    let moved = false;
    for (const poly of colliders) {
      let best: { point: Vec2; distance: number } | null = null;
      for (let i = 0; i < poly.length; i++) {
        const c = closestPointOnSegment(pos, poly[i], poly[(i + 1) % poly.length]);
        if (!best || c.distance < best.distance) best = c;
      }
      if (!best) continue;
      const inside = pointInPolygon(pos, poly);
      if (!inside && best.distance >= radius) continue;
      let dx = pos.x - best.point.x;
      let dy = pos.y - best.point.y;
      let len = Math.hypot(dx, dy);
      if (len < 1e-9) {
        // exactly on the edge: push away from polygon centroid
        const cx = poly.reduce((s, q) => s + q.x, 0) / poly.length;
        const cy = poly.reduce((s, q) => s + q.y, 0) / poly.length;
        const v = sub(pos, { x: cx, y: cy });
        dx = v.x;
        dy = v.y;
        len = Math.hypot(dx, dy) || 1;
      }
      const sign = inside ? -1 : 1;
      const push = inside ? best.distance + radius : radius - best.distance;
      pos = { x: pos.x + ((sign * dx) / len) * push, y: pos.y + ((sign * dy) / len) * push };
      moved = true;
    }
    if (!moved) break;
  }
  return pos;
}
