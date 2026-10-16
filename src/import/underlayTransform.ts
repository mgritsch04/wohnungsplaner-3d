import type { Underlay } from '../model/schema';
import { add, rotate, scale, sub, type Vec2 } from '../model/vec';

type UnderlayPose = Pick<Underlay, 'x' | 'y' | 'rotation' | 'metersPerPixel'>;

/** Image pixel → plan coordinates (meters). */
export function imageToWorld(u: UnderlayPose, p: Vec2): Vec2 {
  return add({ x: u.x, y: u.y }, rotate(scale(p, u.metersPerPixel), u.rotation));
}

/** Plan coordinates (meters) → image pixel. */
export function worldToImage(u: UnderlayPose, p: Vec2): Vec2 {
  return scale(rotate(sub(p, { x: u.x, y: u.y }), -u.rotation), 1 / u.metersPerPixel);
}

/**
 * Compute a new scale from two image points and a known real distance,
 * keeping the first point fixed in plan space.
 */
export function calibrateUnderlay(u: UnderlayPose, p1Image: Vec2, p2Image: Vec2, meters: number): UnderlayPose {
  const pxDist = Math.hypot(p2Image.x - p1Image.x, p2Image.y - p1Image.y);
  if (!(pxDist > 0) || !(meters > 0)) throw new Error('Ungültige Kalibrierung');
  const anchorWorld = imageToWorld(u, p1Image);
  const metersPerPixel = meters / pxDist;
  const origin = sub(anchorWorld, rotate(scale(p1Image, metersPerPixel), u.rotation));
  return { ...u, metersPerPixel, x: origin.x, y: origin.y };
}

/** Relative deviation between a measured distance on the calibrated plan and a known real value. */
export function calibrationDeviation(u: UnderlayPose, a: Vec2, b: Vec2, knownMeters: number): number {
  const measured = Math.hypot(b.x - a.x, b.y - a.y) * u.metersPerPixel;
  return (measured - knownMeters) / knownMeters;
}
