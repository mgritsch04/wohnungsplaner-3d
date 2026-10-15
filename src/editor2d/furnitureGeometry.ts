import type { Furniture } from '../model/schema';
import { rotate, add, type Vec2, sub } from '../model/vec';

/** Footprint corners of a furniture item in plan coordinates. Local -y is the back side. */
export function furnitureCorners(f: Pick<Furniture, 'x' | 'y' | 'width' | 'depth' | 'rotation'>): Vec2[] {
  const hw = f.width / 2;
  const hd = f.depth / 2;
  return [
    { x: -hw, y: -hd },
    { x: hw, y: -hd },
    { x: hw, y: hd },
    { x: -hw, y: hd },
  ].map((c) => add({ x: f.x, y: f.y }, rotate(c, f.rotation)));
}

/** Point in local (unrotated, centered) furniture coordinates. */
export function toFurnitureLocal(f: Pick<Furniture, 'x' | 'y' | 'rotation'>, p: Vec2): Vec2 {
  return rotate(sub(p, { x: f.x, y: f.y }), -f.rotation);
}

export function pointInFurniture(f: Furniture, p: Vec2, pad = 0): boolean {
  const l = toFurnitureLocal(f, p);
  return Math.abs(l.x) <= f.width / 2 + pad && Math.abs(l.y) <= f.depth / 2 + pad;
}

/** Separating-axis test for two rotated rectangles (footprints). */
export function footprintsOverlap(a: Vec2[], b: Vec2[], eps = 1e-4): boolean {
  const axes = [a, b].flatMap((poly) =>
    poly.map((p, i) => {
      const q = poly[(i + 1) % poly.length];
      return { x: -(q.y - p.y), y: q.x - p.x };
    }),
  );
  for (const ax of axes) {
    const proj = (poly: Vec2[]) => poly.map((p) => p.x * ax.x + p.y * ax.y);
    const pa = proj(a);
    const pb = proj(b);
    const len = Math.hypot(ax.x, ax.y) || 1;
    if (Math.max(...pa) <= Math.min(...pb) + eps * len || Math.max(...pb) <= Math.min(...pa) + eps * len) return false;
  }
  return true;
}
