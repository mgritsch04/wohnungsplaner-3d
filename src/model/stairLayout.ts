import type { Vec2 } from './vec';

/**
 * Geometry of the stair shapes (#54, #335), in the stair's local plan frame (origin at the footprint
 * centre, x = width, y = depth, +y is the front where the climb starts). One layout feeds the 2D
 * symbol, the 3D model, the walking surface and the stairwell, so they cannot drift apart.
 *
 * Shapes (a trailing `-r` mirrors the stair): `stairs` straight flight, `stairs-quarter-landing` /
 * `stairs-quarter-winder` quarter turn with a landing or with winders, `stairs-half-landing` /
 * `stairs-half-winder` half turn (U) with a landing or with winders, `stairs-spiral` spiral stair.
 * They are all plain procedural shapes, so no project schema change is needed.
 */
export type StairKind = 'straight' | 'quarter-landing' | 'quarter-winder' | 'half-landing' | 'half-winder' | 'spiral';

const KINDS: Record<string, StairKind> = {
  stairs: 'straight',
  'stairs-quarter-landing': 'quarter-landing',
  'stairs-quarter-winder': 'quarter-winder',
  'stairs-half-landing': 'half-landing',
  'stairs-half-winder': 'half-winder',
  'stairs-spiral': 'spiral',
};

/** Comfortable rise of one step (m); the number of steps follows from the height. */
export const STEP_RISE = 0.18;

export function stepCount(height: number): number {
  return Math.max(2, Math.round(height / STEP_RISE));
}

export function parseStairShape(shape: string): { kind: StairKind; mirror: boolean } | null {
  const mirror = shape.endsWith('-r');
  const kind = KINDS[mirror ? shape.slice(0, -2) : shape];
  if (!kind || (mirror && kind === 'straight')) return null;
  return { kind, mirror };
}

/** One step: its plan outline and the height of its top above the stair's foot. */
export interface StairTread {
  poly: Vec2[];
  top: number;
}

/** A part of the walking surface: height runs from z0 to z1 with the progress t(p) in 0…1. */
export interface StairPiece {
  poly: Vec2[];
  z0: number;
  z1: number;
  t: (p: Vec2) => number;
}

export interface StairLayout {
  treads: StairTread[];
  pieces: StairPiece[];
  /** Convex parts that together make the stairwell (the opening in the floor above). */
  well: Vec2[][];
}

type Rect = { x0: number; y0: number; x1: number; y1: number };

const rectPoly = (r: Rect): Vec2[] => [
  { x: r.x0, y: r.y0 },
  { x: r.x1, y: r.y0 },
  { x: r.x1, y: r.y1 },
  { x: r.x0, y: r.y1 },
];

/** Sutherland–Hodgman clip of a convex polygon to an axis-aligned rectangle. */
function clipRect(poly: Vec2[], r: Rect): Vec2[] {
  const planes: Array<{ inside: (p: Vec2) => number }> = [
    { inside: (p) => p.x - r.x0 },
    { inside: (p) => r.x1 - p.x },
    { inside: (p) => p.y - r.y0 },
    { inside: (p) => r.y1 - p.y },
  ];
  let out = poly;
  for (const pl of planes) {
    const next: Vec2[] = [];
    for (let i = 0; i < out.length; i++) {
      const a = out[i];
      const b = out[(i + 1) % out.length];
      const sa = pl.inside(a);
      const sb = pl.inside(b);
      if (sa >= 0) next.push(a);
      if (sa >= 0 !== sb >= 0) {
        const t = sa / (sa - sb);
        next.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
    out = next;
  }
  return out;
}

type Dir = '-y' | '+y' | '+x';

class Builder {
  treads: StairTread[] = [];
  pieces: StairPiece[] = [];
  constructor(readonly rise: number) {}

  /** A straight flight of `k` treads starting at tread level `base`; `extra` lifts its end to the landing level. */
  flight(r: Rect, dir: Dir, k: number, base: number, extra = 0): void {
    const len = dir === '+x' ? r.x1 - r.x0 : r.y1 - r.y0;
    for (let i = 0; i < k; i++) {
      const a = i / k;
      const b = (i + 1) / k;
      const s: Rect =
        dir === '-y' ? { ...r, y0: r.y1 - b * len, y1: r.y1 - a * len } : dir === '+y' ? { ...r, y0: r.y0 + a * len, y1: r.y0 + b * len } : { ...r, x0: r.x0 + a * len, x1: r.x0 + b * len };
      this.treads.push({ poly: rectPoly(s), top: (base + i + 1) * this.rise });
    }
    const t = (p: Vec2) => (dir === '-y' ? (r.y1 - p.y) / len : dir === '+y' ? (p.y - r.y0) / len : (p.x - r.x0) / len);
    this.pieces.push({ poly: rectPoly(r), z0: base * this.rise, z1: (base + k + extra) * this.rise, t });
  }

  /** A flat landing that is the tread at level `level`. */
  landing(r: Rect, level: number): void {
    this.treads.push({ poly: rectPoly(r), top: level * this.rise });
    this.pieces.push({ poly: rectPoly(r), z0: level * this.rise, z1: level * this.rise, t: () => 0 });
  }

  /**
   * `m` winders fanning round `c` in the zone `r`: the climb turns by `total` radians from the
   * direction −x towards −y and on (dir(θ) = (−cos θ, −sin θ)).
   */
  winders(r: Rect, c: Vec2, total: number, m: number, base: number): void {
    const big = 4 * Math.max(r.x1 - r.x0, r.y1 - r.y0);
    const at = (th: number): Vec2 => ({ x: c.x - Math.cos(th) * big, y: c.y - Math.sin(th) * big });
    for (let i = 0; i < m; i++) {
      const tri = [c, at((total * i) / m), at((total * (i + 1)) / m)];
      this.treads.push({ poly: clipRect(tri, r), top: (base + i + 1) * this.rise });
    }
    const t = (p: Vec2) => Math.atan2(-(p.y - c.y), -(p.x - c.x)) / total;
    this.pieces.push({ poly: rectPoly(r), z0: base * this.rise, z1: (base + m) * this.rise, t });
  }
}

/** Number of treads for a flight pair split in proportion to the flight lengths (each gets at least one). */
function split(free: number, l1: number, l2: number): [number, number] {
  const n1 = Math.min(free - 1, Math.max(1, Math.round((free * l1) / (l1 + l2))));
  return [n1, free - n1];
}

function build(kind: StairKind, w: number, d: number, h: number): StairLayout {
  const W = w / 2;
  const D = d / 2;
  const minSteps: Record<StairKind, number> = { straight: 2, 'quarter-landing': 4, 'quarter-winder': 6, 'half-landing': 4, 'half-winder': 9, spiral: 6 };
  const n = Math.max(stepCount(h), minSteps[kind]);
  const b = new Builder(h / n);
  let well: Vec2[][];

  if (kind === 'straight') {
    const r = { x0: -W, y0: -D, x1: W, y1: D };
    b.flight(r, '-y', n, 0);
    well = [rectPoly(r)];
  } else if (kind === 'quarter-landing' || kind === 'quarter-winder') {
    // up the left side, turn at the back-left corner, on along the back wall to the right
    const fw = Math.max(0.5, Math.min(0.9, w * 0.45, d * 0.45));
    const col: Rect = { x0: -W, y0: -D + fw, x1: -W + fw, y1: D };
    const row: Rect = { x0: -W + fw, y0: -D, x1: W, y1: -D + fw };
    const corner: Rect = { x0: -W, y0: -D, x1: -W + fw, y1: -D + fw };
    const m = kind === 'quarter-winder' ? 3 : 1;
    const [n1, n2] = split(n - m, d - fw, w - fw);
    if (kind === 'quarter-landing') {
      b.flight(col, '-y', n1, 0, 1);
      b.landing(corner, n1 + 1);
    } else {
      b.flight(col, '-y', n1, 0);
      b.winders(corner, { x: -W + fw, y: -D + fw }, Math.PI / 2, m, n1);
    }
    b.flight(row, '+x', n2, n1 + m);
    well = [rectPoly({ x0: -W, y0: -D, x1: -W + fw, y1: D }), rectPoly(row)];
  } else if (kind === 'half-landing' || kind === 'half-winder') {
    // up the left half, turn at the back, down the right half; the top is at the front right
    const fl = w / 2;
    const m = kind === 'half-winder' ? 6 : 1;
    const free = n - m;
    const n1 = Math.floor(free / 2);
    const n2 = free - n1;
    const left: Rect = { x0: -W, y0: -D + fl, x1: 0, y1: D };
    const right: Rect = { x0: 0, y0: -D + fl, x1: W, y1: D };
    const back: Rect = { x0: -W, y0: -D, x1: W, y1: -D + fl };
    if (kind === 'half-landing') {
      b.flight(left, '-y', n1, 0, 1);
      b.landing(back, n1 + 1);
    } else {
      b.flight(left, '-y', n1, 0);
      b.winders(back, { x: 0, y: -D + fl }, Math.PI, m, n1);
    }
    b.flight(right, '+y', n2, n1 + m);
    well = [rectPoly({ x0: -W, y0: -D, x1: W, y1: D })];
  } else {
    // spiral: one full turn, treads are wedges round the centre pole
    const R = Math.min(w, d) / 2;
    const arc = (th: number): Vec2 => ({ x: Math.sin(th) * R, y: Math.cos(th) * R });
    for (let i = 0; i < n; i++) {
      const poly: Vec2[] = [{ x: 0, y: 0 }];
      for (let k = 0; k <= 4; k++) poly.push(arc(((i + k / 4) / n) * Math.PI * 2));
      b.treads.push({ poly, top: (i + 1) * b.rise });
    }
    const circle = Array.from({ length: 24 }, (_, i) => arc((i / 24) * Math.PI * 2));
    const t = (p: Vec2) => (((Math.atan2(p.x, p.y) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2);
    b.pieces.push({ poly: circle, z0: 0, z1: h, t });
    well = [circle];
  }
  return { treads: b.treads, pieces: b.pieces, well };
}

function mirrorLayout(l: StairLayout): StairLayout {
  const flip = (poly: Vec2[]) => poly.map((p) => ({ x: -p.x, y: p.y })).reverse();
  return {
    treads: l.treads.map((t) => ({ ...t, poly: flip(t.poly) })),
    pieces: l.pieces.map((pc) => ({ ...pc, poly: flip(pc.poly), t: (p: Vec2) => pc.t({ x: -p.x, y: p.y }) })),
    well: l.well.map(flip),
  };
}

const cache = new Map<string, StairLayout>();

/** Layout of a stair shape for the given size, or null when `shape` is not a stair. */
export function stairLayout(shape: string, w: number, d: number, h: number): StairLayout | null {
  const parsed = parseStairShape(shape);
  if (!parsed) return null;
  const key = `${shape}|${w.toFixed(3)}|${d.toFixed(3)}|${h.toFixed(3)}`;
  let l = cache.get(key);
  if (!l) {
    l = build(parsed.kind, w, d, h);
    if (parsed.mirror) l = mirrorLayout(l);
    if (cache.size > 200) cache.clear();
    cache.set(key, l);
  }
  return l;
}

function inConvex(poly: Vec2[], p: Vec2, eps = 1e-6): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const c = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    if (Math.abs(c / len) <= eps) continue;
    const s = c > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/** Height of the walking surface at a local point (null outside the stair). */
export function layoutSurfaceAt(l: StairLayout, p: Vec2): number | null {
  for (const pc of l.pieces) {
    if (inConvex(pc.poly, p)) return pc.z0 + (pc.z1 - pc.z0) * Math.min(1, Math.max(0, pc.t(p)));
  }
  return null;
}
