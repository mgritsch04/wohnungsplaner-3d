/**
 * Fitting an imported 3D model into its stored box (#350): retailer models are not always
 * modelled the way the planner expects (glTF: X = width, Y = up, Z = depth). Seen in the
 * furnishing proposal: a desk lying flat on the floor and a squashed office chair (axes swapped,
 * then scaled non-uniformly into the box) and a bed standing askew in its box (model turned
 * around the vertical axis). Both are corrected before scaling:
 * - `fitModel`: width and depth swapped in the model (turned by 90°), and a stored height that
 *   contradicts the model (seat height, top thickness) is replaced by the model's own;
 * - `deskewAngle`: a model turned by a few to ~45 degrees around the vertical axis is turned back,
 *   when its footprint then gets clearly smaller (a real product is a box, not a diamond).
 * Pure functions; `FurnitureObject` applies them.
 */

export interface ModelFit {
  /** Model x and z swapped: the model's width runs along its z axis (turn by 90° about the vertical). */
  turn: boolean;
  /** Height to draw (m): the stored height, or – when it contradicts the model's own proportions – the model's. */
  height: number;
  /** The stored height was replaced (it is probably a partial measure such as seat height or top thickness). */
  heightFromModel: boolean;
}

/**
 * How to fit a model of `size` (model units) into the stored box. The footprint may be turned by
 * 90° (width and depth swapped in the model); the height stays the model's up axis, retailer
 * models are Y-up. When the stored height is off by more than 40 % from the model's proportions
 * (e.g. 45 cm seat height of an office chair, 4 cm top of a desk), the model's height wins – the
 * model shows the real product, a squashed one is never right. Flat items keep the stored height.
 */
export function fitModel(size: { x: number; y: number; z: number }, dims: { width: number; depth: number; height: number }): ModelFit {
  const dev = (w: number, d: number) => Math.abs(Math.log(w / dims.width)) + Math.abs(Math.log(d / dims.depth));
  const x = Math.max(size.x, 1e-4);
  const z = Math.max(size.z, 1e-4);
  // proportions only: the model's unit is unknown, so compare ratios to the stored footprint
  const k = Math.sqrt((dims.width * dims.depth) / (x * z));
  const turn = Math.abs(x - z) / Math.max(x, z) > 0.15 && dev(z * k, x * k) + 0.2 < dev(x * k, z * k);
  const sx = (turn ? dims.depth : dims.width) / x;
  const sz = (turn ? dims.width : dims.depth) / z;
  const modelHeight = Math.max(size.y, 1e-4) * Math.sqrt(sx * sz);
  // flat by the model (rug, picture): keep the stored height; a "flat" stored height with a tall model is the error case
  const flat = modelHeight < 0.06;
  const off = Math.abs(Math.log(dims.height / modelHeight)) > Math.log(1.4);
  return flat || !off ? { turn, height: dims.height, heightFromModel: false } : { turn, height: modelHeight, heightFromModel: true };
}

/** Area of the axis-aligned box of `pts` turned by `a` (radians). */
function boxArea(pts: { x: number; z: number }[], a: number): number {
  const c = Math.cos(a);
  const s = Math.sin(a);
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const p of pts) {
    const x = p.x * c - p.z * s;
    const z = p.x * s + p.z * c;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  return (x1 - x0) * (z1 - z0);
}

/**
 * Turn (radians, about the vertical axis) that straightens a model standing askew in its box,
 * or 0. `pts` are footprint points (x, z) of the model. Turns of under 3° stay (modelling noise),
 * and only a clearly smaller footprint (at most 85 %) counts.
 */
export function deskewAngle(pts: { x: number; z: number }[]): number {
  if (pts.length < 4) return 0;
  const a0 = boxArea(pts, 0);
  if (!(a0 > 0)) return 0;
  let best = 0;
  let bestArea = a0;
  for (let deg = 1; deg < 90; deg++) {
    const a = (deg * Math.PI) / 180;
    const area = boxArea(pts, a);
    if (area < bestArea - 1e-9) {
      bestArea = area;
      best = a;
    }
  }
  const deg = (best * 180) / Math.PI;
  if (bestArea > 0.85 * a0 || deg < 3 || deg > 87) return 0;
  // the smaller of the two equivalent turns
  return best > Math.PI / 4 ? best - Math.PI / 2 : best;
}
