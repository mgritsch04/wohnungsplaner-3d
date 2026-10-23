/**
 * Interior outline of a room as the walls a person sees (#438): clockwise on screen, without the
 * straight-through points a T-junction adds to the model outline, starting at the corner nearest
 * the north-west corner of the bounding box, where wall W1 starts.
 */
import { cross, dist, dot, normalize, signedArea, sub, type Vec2 } from '../../model/vec';

/** A turn below 1° counts as going straight on (T-junction points, rounding). */
const STRAIGHT = Math.sin(Math.PI / 180);

const goesStraight = (prev: Vec2, p: Vec2, next: Vec2) => {
  const u = normalize(sub(p, prev));
  const w = normalize(sub(next, p));
  return Math.abs(cross(u, w)) < STRAIGHT && dot(u, w) > 0;
};

export function wallOutline(poly: Vec2[]): Vec2[] {
  let pts = poly.filter((p, i) => dist(p, poly[(i + 1) % poly.length]) > 1e-3);
  if (signedArea(pts) < 0) pts = [...pts].reverse();
  for (let i = 0; pts.length > 3 && i < pts.length; ) {
    if (goesStraight(pts[(i + pts.length - 1) % pts.length], pts[i], pts[(i + 1) % pts.length])) {
      pts = pts.filter((_, k) => k !== i);
      i = 0;
    } else i++;
  }
  const minX = Math.min(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const nw = (p: Vec2) => Math.hypot(p.x - minX, p.y - minY);
  let start = 0;
  pts.forEach((p, i) => {
    const b = pts[start];
    if (nw(p) < nw(b) - 1e-6 || (Math.abs(nw(p) - nw(b)) <= 1e-6 && (p.y < b.y || (p.y === b.y && p.x < b.x)))) start = i;
  });
  return [...pts.slice(start), ...pts.slice(0, start)];
}
