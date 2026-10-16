/**
 * Synthetic floor plans for unit tests only (not used by the app).
 *
 * Plans are generated geometrically – walls as filled strips with mitred
 * corners, door gaps as cut-outs – so tests know the exact ground truth.
 * Nothing here is derived from a real floor plan.
 */
import { offsetPolygon, pointInPolygon, type Vec2 } from '../../model/vec';

export interface SyntheticPlanSpec {
  width: number;
  height: number;
  /** Pixels per metre. */
  pxPerM: number;
  /** Wall thickness in metres. */
  thickness: number;
  /** Closed outer wall centerline polygon (metres). */
  outline?: Vec2[];
  /** Additional straight walls (centerlines in metres), e.g. interior walls. */
  walls?: [Vec2, Vec2][];
  /** Door/passage gaps: the part of a wall centerline from `a` to `b` is cut out. */
  gaps?: [Vec2, Vec2][];
  /** Optional thin lines (e.g. door leaves, arcs) as polylines in metres, 1 px wide. */
  thinLines?: Vec2[][];
}

function distToSegment(p: Vec2, a: Vec2, b: Vec2): { along: number; across: number; len: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const px = p.x - a.x;
  const py = p.y - a.y;
  return { along: px * ux + py * uy, across: Math.abs(-px * uy + py * ux), len };
}

/** Render a synthetic plan as an 8-bit grayscale image (walls 20, background 255). */
export function renderSyntheticPlan(spec: SyntheticPlanSpec): { width: number; height: number; gray: Uint8ClampedArray; metersPerPixel: number } {
  const { width: W, height: H, pxPerM, thickness: t } = spec;
  const gray = new Uint8ClampedArray(W * H).fill(255);
  const outer = spec.outline ? offsetPolygon(spec.outline, t / 2) : null;
  const inner = spec.outline ? offsetPolygon(spec.outline, -t / 2) : null;
  const half = t / 2;
  const gapHalf = half + 2 / pxPerM;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = { x: x / pxPerM, y: y / pxPerM };
      let wall = !!outer && !!inner && pointInPolygon(p, outer) && !pointInPolygon(p, inner);
      if (!wall && spec.walls) {
        for (const [a, b] of spec.walls) {
          const d = distToSegment(p, a, b);
          if (d.across <= half && d.along >= -half && d.along <= d.len + half) {
            wall = true;
            break;
          }
        }
      }
      if (wall && spec.gaps) {
        for (const [a, b] of spec.gaps) {
          const d = distToSegment(p, a, b);
          if (d.across <= gapHalf && d.along >= 0 && d.along <= d.len) {
            wall = false;
            break;
          }
        }
      }
      if (wall) gray[y * W + x] = 20;
    }
  }
  for (const line of spec.thinLines ?? []) {
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i];
      const b = line[i + 1];
      const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * pxPerM * 2);
      for (let k = 0; k <= n; k++) {
        const x = Math.round((a.x + ((b.x - a.x) * k) / n) * pxPerM);
        const y = Math.round((a.y + ((b.y - a.y) * k) / n) * pxPerM);
        if (x >= 0 && y >= 0 && x < W && y < H) gray[y * W + x] = 40;
      }
    }
  }
  return { width: W, height: H, gray, metersPerPixel: 1 / pxPerM };
}

/** Quarter-circle door arc as a polyline (hinge at `hinge`, leaf of length r starting towards `from` angle). */
export function doorArc(hinge: Vec2, r: number, fromRad: number, toRad: number, steps = 24): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = fromRad + ((toRad - fromRad) * i) / steps;
    pts.push({ x: hinge.x + r * Math.cos(a), y: hinge.y + r * Math.sin(a) });
  }
  return pts;
}

/**
 * Outline segments (both faces of every wall) of a centerline polygon, as a CAD
 * program would export them to a vector PDF. Coordinates in pixels.
 */
export function outlineSegments(centerline: Vec2[], thickness: number, pxPerM: number): { x1: number; y1: number; x2: number; y2: number }[] {
  const out: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (const poly of [offsetPolygon(centerline, thickness / 2), offsetPolygon(centerline, -thickness / 2)]) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      out.push({ x1: a.x * pxPerM, y1: a.y * pxPerM, x2: b.x * pxPerM, y2: b.y * pxPerM });
    }
  }
  return out;
}
