/**
 * Where an item carried in the walkthrough (#39) goes: where the gaze meets the floor,
 * 1.1–4 m ahead – or, for small items that stand on furniture (#219), on the top of the
 * table/cabinet the gaze points at, so a basket can be put on a table by looking at it.
 */
import { furnitureCorners } from '../editor2d/furnitureGeometry';
import { isStackable, isSurface } from '../model/placementRules';
import type { Furniture } from '../model/schema';
import { roundMm } from '../model/units';
import { pointInPolygon, type Vec2 } from '../model/vec';

export const CARRY_MIN = 1.1;
export const CARRY_MAX = 4;

/** `eye`: camera position (x, height, z = plan y); `dir`: unit view direction in the same axes. */
export function carryGoal(eye: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, furniture: readonly Furniture[], carriedId: string): Vec2 {
  const flat = Math.hypot(dir.x, dir.z) || 1;
  const carried = furniture.find((f) => f.id === carriedId);
  if (carried && isStackable(carried) && dir.y < -0.01) {
    let best: { t: number; p: Vec2 } | null = null;
    for (const s of furniture) {
      if (s.id === carriedId || !isSurface(s)) continue;
      const top = s.elevation + s.height;
      if (top >= eye.y) continue;
      const t = (eye.y - top) / -dir.y;
      if (t * flat > CARRY_MAX || (best && t >= best.t)) continue;
      const p = { x: eye.x + dir.x * t, y: eye.z + dir.z * t };
      if (pointInPolygon(p, furnitureCorners(s))) best = { t, p };
    }
    if (best) return { x: roundMm(best.p.x), y: roundMm(best.p.y) };
  }
  let dist = CARRY_MAX;
  if (dir.y < -0.01) dist = Math.min(CARRY_MAX, Math.max(CARRY_MIN, ((eye.y - 0.3) * flat) / -dir.y));
  return { x: roundMm(eye.x + (dir.x / flat) * dist), y: roundMm(eye.z + (dir.z / flat) * dist) };
}
